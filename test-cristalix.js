/**
 * Тестовый скрипт для проверки Cristalix API
 * Запуск: node test-cristalix.js
 */

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjSSI6IjJmMmFlZjM4LWEyNjAtMTFlZC05ZDQyLTFjYjcyY2IwMTRhZSIsInBJeSI6ImVmM2QwNjQ5LTM4NmQtNDZjNi1iNjVlLTEwODAxOTEyYWI1NyIsInNJIjoiMWZiOTNmN2MtODE0NS00Zjk1LTllY2MtOWE2MjM2MmYxNDZlIiwiaWF0IjoxNzcxMjU1MzczLCJpc3MiOiJDcmlzdGFsaXhPcGVuQXBpIn0.vmA2l_gNfRrK6fCKRsz95rTHGKf7s1UTHXOmsrcCq4c';
const PROJECT_KEY = 'ef3d0649-386d-46c6-b65e-10801912ab57';

async function testWithPuppeteer() {
  const puppeteer = require('puppeteer');
  
  console.log('Запускаем Puppeteer...');
  const browser = await puppeteer.launch({ headless: false }); // headless: false чтобы видеть браузер
  const page = await browser.newPage();
  
  // Включаем перехват запросов
  await page.setRequestInterception(true);
  
  page.on('request', (request) => {
    const headers = {
      ...request.headers(),
      'Authorization': `Bearer ${TOKEN}`,
    };
    
    console.log('Отправляем запрос с заголовками:', {
      url: request.url(),
      authorization: headers.Authorization.substring(0, 30) + '...',
    });
    
    request.continue({ headers });
  });
  
  const url = `https://api.cristalix.gg/players/v1/getProfileByName?playerName=Brendished&project_key=${PROJECT_KEY}`;
  
  console.log(`\nОткрываем URL: ${url}\n`);
  
  const response = await page.goto(url, { waitUntil: 'networkidle0' });
  
  console.log(`\nСтатус: ${response.status()}`);
  
  const text = await page.evaluate(() => document.body.textContent);
  console.log(`\nОтвет:\n${text}\n`);
  
  await browser.close();
}

async function testWithFetch() {
  console.log('\n=== Тест с обычным fetch (для сравнения) ===\n');
  
  const url = `https://api.cristalix.gg/players/v1/getProfileByName?playerName=Brendished&project_key=${PROJECT_KEY}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
      },
    });
    
    console.log(`Статус: ${response.status}`);
    const data = await response.text();
    console.log(`Ответ:\n${data}\n`);
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

async function main() {
  console.log('=== Тест Cristalix API ===\n');
  console.log(`Token (первые 30 символов): ${TOKEN.substring(0, 30)}...`);
  console.log(`Token (последние 30 символов): ...${TOKEN.substring(TOKEN.length - 30)}`);
  console.log(`Token длина: ${TOKEN.length}\n`);
  
  await testWithFetch();
  await testWithPuppeteer();
}

main().catch(console.error);
