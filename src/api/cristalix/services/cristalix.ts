/**
 * Cristalix service — загрузка профилей игроков через Puppeteer или обычный fetch
 * Оптимизировано для Railway: один браузер, очередь запросов, fallback без Puppeteer
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fetch } from 'undici';

// Добавляем stealth plugin для обхода Cloudflare
puppeteer.use(StealthPlugin());

interface PlayerProfile {
  uuid: string;
  skinUrl: string;
  timestamp: number;
}

const playerCache = new Map<string, PlayerProfile>();
const CACHE_DURATION = 3600000; // 1 час

const CRISTALIX_API = {
  baseUrl: 'https://api.cristalix.gg',
  projectKey: process.env.CRISTALIX_PROJECT_KEY || 'ef3d0649-386d-46c6-b65e-10801912ab57',
  token: process.env.CRISTALIX_TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjSSI6IjJmMmFlZjM4LWEyNjAtMTFlZC05ZDQyLTFjYjcyY2IwMTRhZSIsInBJeSI6ImVmM2QwNjQ5LTM4NmQtNDZjNi1iNjVlLTEwODAxOTEyYWI1NyIsInNJIjoiMWZiOTNmN2MtODE0NS00Zjk1LTllY2MtOWE2MjM2MmYxNDZlIiwiaWF0IjoxNzcxMjU1MzczLCJpc3MiOiJDcmlzdGFsaXhPcGVuQXBpIn0.vmA2l_gNfRrK6fCKRsz95rTHGKf7s1UTHXOmsrcCq4c',
};

// Очередь запросов для ограничения параллелизма
const requestQueue: Array<() => Promise<void>> = [];
const MAX_CONCURRENT_PAGES = 3; // Максимум 3 страницы одновременно
let activePages = 0;

let browser: any = null;
let browserInitializePromise: Promise<any> | null = null;

/**
 * Инициализировать браузер (ленивая загрузка)
 */
async function initializeBrowser() {
  if (!browserInitializePromise) {
    browserInitializePromise = (async () => {
      try {
        browser = await puppeteer.launch({
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--single-process',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',
            '--disable-hardware-animation',
          ],
        });
        strapi.log.info('Puppeteer: браузер запущен');
        return browser;
      } catch (error) {
        strapi.log.error('Puppeteer: не удалось запустить браузер, используем fallback', error);
        browserInitializePromise = null;
        return null;
      }
    })();
  }
  return browserInitializePromise;
}

/**
 * Выполнить задачу с ограничением параллелизма
 */
async function executeWithQueue(task: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const executeTask = async () => {
      try {
        activePages++;
        await task();
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        activePages--;
        processQueue();
      }
    };

    const processQueue = () => {
      if (activePages < MAX_CONCURRENT_PAGES && requestQueue.length > 0) {
        const nextTask = requestQueue.shift();
        if (nextTask) nextTask();
      }
    };

    if (activePages < MAX_CONCURRENT_PAGES) {
      executeTask();
    } else {
      requestQueue.push(executeTask);
    }
  });
}

/**
 * Обычный fetch с заголовками (fallback)
 */
async function fetchWithFallback(url: string, options: any = {}): Promise<any> {
  const authToken = CRISTALIX_API.token.startsWith('Bearer ')
    ? CRISTALIX_API.token
    : `Bearer ${CRISTALIX_API.token}`;

  try {
    strapi.log.info(`Fetch: запрос к ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    strapi.log.info(`Fetch: успешно получено`);
    return data;

  } catch (error) {
    strapi.log.error(`Fetch error:`, error);
    throw error;
  }
}

/**
 * POST запрос через обычный fetch (fallback)
 */
async function postWithFallback(url: string, body: any, headers: any): Promise<any> {
  const authToken = CRISTALIX_API.token.startsWith('Bearer ')
    ? CRISTALIX_API.token
    : `Bearer ${CRISTALIX_API.token}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    return JSON.parse(text);

  } catch (error) {
    strapi.log.error(`POST fetch error:`, error);
    throw error;
  }
}

/**
 * Выполнить fetch через Puppeteer (основной метод)
 */
async function fetchWithBrowser(url: string, options: any = {}): Promise<any> {
  return executeWithQueue(async () => {
    const browserInstance = await initializeBrowser();
    
    if (!browserInstance) {
      // Браузер не доступен, используем fallback
      strapi.log.info('Puppeteer недоступен, используем обычный fetch');
      return fetchWithFallback(url, options);
    }

    const page = await browserInstance.newPage();
    let success = false;

    try {
      // Устанавливаем таймаут
      page.setDefaultTimeout(15000);

      // Устанавливаем заголовки до навигации
      await page.setExtraHTTPHeaders({
        'Authorization': options.headers?.Authorization || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      strapi.log.info(`Puppeteer: запрос к ${url}`);

      // Открываем страницу
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      const status = response?.status();
      strapi.log.info(`Puppeteer: статус ${status}`);

      // Извлекаем текст со страницы
      const jsonText = await page.evaluate(() => {
        const preTag = document.querySelector('pre');
        if (preTag) return preTag.textContent;
        return document.body.textContent || document.body.innerText;
      });

      strapi.log.info(`Puppeteer: ответ (первые 200 символов): ${jsonText?.substring(0, 200)}`);

      // Парсим JSON
      try {
        const parsed = JSON.parse(jsonText || '{}');
        strapi.log.info(`Puppeteer: успешно распарсен JSON`);
        success = true;
        return parsed;
      } catch (e) {
        strapi.log.error('Puppeteer: Failed to parse JSON:', jsonText?.substring(0, 500));
        throw new Error('Invalid JSON response');
      }

    } catch (error) {
      strapi.log.error('Puppeteer error, используем fallback:', (error as Error).message);
      // При ошибке пробуем обычный fetch
      return fetchWithFallback(url, options);
    } finally {
      // Всегда закрываем страницу
      try {
        await page.close();
      } catch (e) {
        // Игнорируем ошибки закрытия
      }
    }
  });
}

/**
 * POST запрос через Puppeteer
 */
async function postWithBrowser(url: string, body: any, headers: any): Promise<any> {
  return executeWithQueue(async () => {
    const browserInstance = await initializeBrowser();
    
    if (!browserInstance) {
      strapi.log.info('Puppeteer недоступен, используем обычный fetch');
      return postWithFallback(url, body, headers);
    }

    const page = await browserInstance.newPage();
    let success = false;

    try {
      page.setDefaultTimeout(15000);
      await page.setExtraHTTPHeaders(headers);

      strapi.log.info(`Puppeteer POST: ${url}`);

      const result = await page.evaluate(async (apiUrl, apiBody, apiHeaders) => {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify(apiBody),
        });
        return await response.text();
      }, url, body, headers);

      strapi.log.info(`Puppeteer POST: ответ получен`);
      success = true;
      return JSON.parse(result);

    } catch (error) {
      strapi.log.error('Puppeteer POST error, используем fallback:', (error as Error).message);
      return postWithFallback(url, body, headers);
    } finally {
      try {
        await page.close();
      } catch (e) {
        // Игнорируем ошибки закрытия
      }
    }
  });
}

export default () => ({

  async batchGetProfiles(usernames: string[]): Promise<Map<string, { uuid: string; skinUrl: string }>> {
    const result = new Map<string, { uuid: string; skinUrl: string }>();
    const toFetch: string[] = [];

    // Проверяем кэш
    for (const username of usernames) {
      const cached = playerCache.get(username.toLowerCase());
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        result.set(username, { uuid: cached.uuid, skinUrl: cached.skinUrl });
      } else {
        toFetch.push(username);
      }
    }

    if (toFetch.length === 0) {
      strapi.log.info(`Cristalix: все ${usernames.length} игроков из кэша`);
      return result;
    }

    strapi.log.info(`Cristalix: загружаем ${toFetch.length} игроков`);

    // Разбиваем на чанки по 50
    const chunks: string[][] = [];
    for (let i = 0; i < toFetch.length; i += 50) {
      chunks.push(toFetch.slice(i, i + 50));
    }

    for (const chunk of chunks) {
      try {
        const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfilesByNames?project_key=${CRISTALIX_API.projectKey}`;

        const headers = {
          'Authorization': `Bearer ${CRISTALIX_API.token}`,
          'Content-Type': 'application/json',
        };

        const data = await postWithBrowser(url, { array: chunk }, headers);
        const profiles: any[] = Array.isArray(data) ? data : [];

        for (const profile of profiles) {
          const username = profile?.username;
          const uuid = profile?.id;
          const skinUrl = profile?.textures?.skin;

          if (!username || !uuid || !skinUrl) continue;

          playerCache.set(username.toLowerCase(), {
            uuid,
            skinUrl,
            timestamp: Date.now(),
          });

          result.set(username, { uuid, skinUrl });
        }

        strapi.log.info(`Cristalix: загружено ${profiles.length} из ${chunk.length}`);

      } catch (error) {
        strapi.log.error(`Cristalix batch error:`, error);
      }
    }

    return result;
  },

  async getSkinByUsername(username: string): Promise<{ uuid: string | null; skinUrl: string | null; headUrl: string | null }> {
    if (!username) return { uuid: null, skinUrl: null, headUrl: null };

    // Проверяем кэш
    const cached = playerCache.get(username.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return { uuid: cached.uuid, skinUrl: cached.skinUrl, headUrl: cached.skinUrl };
    }

    try {
      const url = `${CRISTALIX_API.baseUrl}/players/v1/getProfileByName?playerName=${encodeURIComponent(username)}&project_key=${CRISTALIX_API.projectKey}`;

      const authToken = CRISTALIX_API.token.startsWith('Bearer ')
        ? CRISTALIX_API.token
        : `Bearer ${CRISTALIX_API.token}`;

      const headers = {
        'Authorization': authToken,
      };

      strapi.log.info(`Cristalix: токен ${authToken.substring(0, 30)}...`);

      const data = await fetchWithBrowser(url, { headers });

      const uuid = data?.id;
      const skinUrl = data?.textures?.skin;

      if (!uuid || !skinUrl) {
        strapi.log.warn(`Cristalix: данные не найдены для ${username}`);
        return { uuid: null, skinUrl: null, headUrl: null };
      }

      // Сохраняем в кэш
      playerCache.set(username.toLowerCase(), { uuid, skinUrl, timestamp: Date.now() });

      return { uuid, skinUrl, headUrl: skinUrl };

    } catch (error) {
      strapi.log.error(`Cristalix error for ${username}:`, error);
      return { uuid: null, skinUrl: null, headUrl: null };
    }
  },

  async getPlayerUUID(username: string): Promise<string | null> {
    const result = await this.getSkinByUsername(username);
    return result.uuid;
  },

  clearCache(): void {
    playerCache.clear();
    strapi.log.info('Cristalix cache cleared');
  },

  getCacheStats() {
    const now = Date.now();
    return {
      size: playerCache.size,
      entries: Array.from(playerCache.entries()).map(([username, data]) => ({
        username,
        uuid: data.uuid,
        ageSeconds: Math.floor((now - data.timestamp) / 1000),
      })),
    };
  },

  async closeBrowser(): Promise<void> {
    if (browser) {
      await browser.close();
      browser = null;
      browserInitializePromise = null;
      strapi.log.info('Puppeteer browser closed');
    }
  },
});
