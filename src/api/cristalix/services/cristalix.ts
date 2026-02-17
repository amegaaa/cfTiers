/**
 * Cristalix service — пакетная загрузка профилей игроков через Puppeteer
 * Использует headless браузер с stealth plugin для обхода Cloudflare protection
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

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

let browser: any = null;

/**
 * Получить или создать браузер
 */
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', // Используем системный Chromium
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
      ],
    });
    
    // Устанавливаем реалистичный User-Agent для всех страниц
    const pages = await browser.pages();
    for (const page of pages) {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }
  }
  return browser;
}

/**
 * Выполнить fetch через Puppeteer
 */
async function fetchWithBrowser(url: string, options: any = {}): Promise<any> {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    strapi.log.info(`Puppeteer: запрос к ${url}`);

    // Включаем перехват запросов
    await page.setRequestInterception(true);

    // Перехватываем все запросы и добавляем заголовки
    page.on('request', (interceptedRequest) => {
      const headers = {
        ...interceptedRequest.headers(),
        ...(options.headers || {}),
      };
      
      // Логируем заголовки для отладки
      const authHeader = headers['Authorization'] || headers['authorization'];
      strapi.log.info(`Puppeteer: Authorization заголовок = "${authHeader}"`);
      strapi.log.info(`Puppeteer: URL = ${interceptedRequest.url()}`);
      
      interceptedRequest.continue({ headers });
    });

    // Открываем страницу API - она пройдёт Cloudflare как браузер
    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    const status = response?.status();
    strapi.log.info(`Puppeteer: статус ${status}`);

    // Извлекаем JSON из тела ответа
    const jsonText = await page.evaluate(() => {
      // @ts-ignore
      const body = document.body;
      // @ts-ignore
      const preTag = document.querySelector('pre');
      
      if (preTag) {
        return preTag.textContent;
      }
      
      return body.textContent || body.innerText;
    });

    strapi.log.info(`Puppeteer: ответ (первые 200 символов): ${jsonText?.substring(0, 200)}`);

    await page.close();

    // Парсим JSON
    try {
      const parsed = JSON.parse(jsonText || '{}');
      strapi.log.info(`Puppeteer: успешно распарсен JSON`);
      return parsed;
    } catch (e) {
      strapi.log.error('Puppeteer: Failed to parse JSON:', jsonText?.substring(0, 500));
      throw new Error('Invalid JSON response');
    }

  } catch (error) {
    strapi.log.error('Puppeteer error:', error);
    await page.close();
    throw error;
  }
}

/**
 * POST запрос через Puppeteer
 */
async function postWithBrowser(url: string, body: any, headers: any): Promise<any> {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();

  try {
    // Устанавливаем заголовки
    await page.setExtraHTTPHeaders(headers);

    // Выполняем POST через page.evaluate
    const result = await page.evaluate(async (apiUrl, apiBody, apiHeaders) => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(apiBody),
      });
      return await response.text();
    }, url, body, headers);

    await page.close();

    return JSON.parse(result);

  } catch (error) {
    await page.close();
    throw error;
  }
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

    strapi.log.info(`Cristalix: загружаем ${toFetch.length} игроков через Puppeteer`);

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

        strapi.log.info(`Cristalix: загружено ${profiles.length} из ${chunk.length} через браузер`);

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

      // Токен уже содержит "Bearer " или нет?
      const authToken = CRISTALIX_API.token.startsWith('Bearer ') 
        ? CRISTALIX_API.token 
        : `Bearer ${CRISTALIX_API.token}`;

      const headers = {
        'Authorization': authToken,
      };

      strapi.log.info(`Cristalix: отправляем токен: ${authToken.substring(0, 30)}...`);

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
      strapi.log.info('Puppeteer browser closed');
    }
  },
});