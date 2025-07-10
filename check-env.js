/**
 * Скрипт для проверки переменных окружения и помощи в настройке
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log('====== ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ======');

// Проверка существования файла .env
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('КРИТИЧЕСКАЯ ОШИБКА: Файл .env отсутствует!');
  console.log('Создайте файл .env на основе .env-example и заполните его правильными значениями.');
} else {
  console.log('✓ Файл .env найден');
}

// Проверка основных настроек Telegram
const telegramConfig = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_GROUP_LINK',
  'ADMIN_TG_ID',
  'ADMIN_TG_IDS',
  'TG_CHAT_ID'
];

console.log('\n====== ПРОВЕРКА НАСТРОЕК TELEGRAM ======');
let telegramErrors = 0;

for (const key of telegramConfig) {
  if (!process.env[key]) {
    console.error(`❌ Отсутствует переменная ${key}`);
    telegramErrors++;
  } else {
    console.log(`✓ ${key} установлен: ${key === 'TELEGRAM_BOT_TOKEN' ? '[СКРЫТ]' : process.env[key]}`);
  }
}

// Проверка ADMIN_TG_IDS, если указан
if (process.env.ADMIN_TG_IDS) {
  try {
    const adminIds = process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim()));
    console.log(`✓ Список админов TG: ${adminIds.join(', ')}`);
  } catch (e) {
    console.error('❌ Ошибка в формате ADMIN_TG_IDS (должен быть список ID через запятую)');
    telegramErrors++;
  }
}

if (telegramErrors === 0) {
  console.log('✓ Все основные настройки Telegram заполнены');
} else {
  console.error(`❌ Обнаружено ${telegramErrors} проблем с настройками Telegram`);
}

// Проверка основных настроек базы данных
console.log('\n====== ПРОВЕРКА НАСТРОЕК БАЗЫ ДАННЫХ ======');
if (!process.env.DB_PATH) {
  console.warn('⚠️ DB_PATH не установлен, будет использован путь по умолчанию: .data/database.sqlite');
} else {
  console.log(`✓ DB_PATH установлен: ${process.env.DB_PATH}`);
}

// Проверка временной директории для Glitch
console.log('\n====== ПРОВЕРКА НАСТРОЕК GLITCH ======');
if (process.env.GLITCH_SHARED_INCLUDES_PATH) {
  console.log(`✓ GLITCH_SHARED_INCLUDES_PATH установлен: ${process.env.GLITCH_SHARED_INCLUDES_PATH}`);
} else {
  console.warn('⚠️ GLITCH_SHARED_INCLUDES_PATH не установлен. Для работы на Glitch может потребоваться указать этот путь.');
}

// Проверка директории /tmp для Unix-систем и создание локальной директории для Windows
const tmpDir = process.env.GLITCH_SHARED_INCLUDES_PATH || path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir) && !tmpDir.startsWith('/tmp')) {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log(`✓ Создана временная директория: ${tmpDir}`);
  } catch (e) {
    console.error(`❌ Не удалось создать временную директорию ${tmpDir}: ${e.message}`);
  }
} else {
  console.log(`✓ Временная директория будет использоваться: ${tmpDir}`);
}

// Проверка установленных npm пакетов
console.log('\n====== ПРОВЕРКА УСТАНОВЛЕННЫХ ПАКЕТОВ ======');
const requiredPackages = ['exceljs', 'telegraf', 'vk-io', 'dotenv'];
const packageJson = require('./package.json');

for (const pkg of requiredPackages) {
  if (packageJson.dependencies[pkg]) {
    console.log(`✓ Пакет ${pkg} установлен (${packageJson.dependencies[pkg]})`);
  } else {
    console.error(`❌ Пакет ${pkg} не найден в package.json`);
  }
}

// Итоговое заключение
console.log('\n====== ИТОГОВОЕ ЗАКЛЮЧЕНИЕ ======');
if (telegramErrors > 0) {
  console.error(`❌ Обнаружены проблемы с настройками. Исправьте их перед запуском ботов.`);
} else {
  console.log('✓ Все основные настройки заполнены. Можно запускать ботов.');
}

// Краткая инструкция для настройки TG бота
console.log('\n====== ИНСТРУКЦИЯ ПО НАСТРОЙКЕ TG БОТА ======');
console.log('1. Создайте бота с помощью @BotFather в Telegram и получите токен');
console.log('2. Укажите токен в переменной TELEGRAM_BOT_TOKEN в файле .env');
console.log('3. Создайте приватную группу/канал и скопируйте ссылку приглашения в TELEGRAM_GROUP_LINK');
console.log('4. Укажите свой Telegram ID в ADMIN_TG_ID для доступа к функциям администратора');
console.log('5. Добавьте бота в группу/канал и сделайте его администратором');
console.log('6. Запустите бота командой: node index.js\n'); 