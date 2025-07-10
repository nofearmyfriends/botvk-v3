/**
 * Скрипт для создания временной директории и настройки окружения
 */
const fs = require('fs');
const path = require('path');

// Создание временной директории
const tmpDir = path.join(__dirname, 'tmp');

if (!fs.existsSync(tmpDir)) {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log(`✓ Временная директория создана: ${tmpDir}`);
  } catch (e) {
    console.error(`❌ Не удалось создать временную директорию ${tmpDir}: ${e.message}`);
  }
} else {
  console.log(`✓ Временная директория уже существует: ${tmpDir}`);
}

// Создаем файл .env если его нет
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env-example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  try {
    const exampleContent = fs.readFileSync(envExamplePath, 'utf8');
    fs.writeFileSync(envPath, exampleContent, 'utf8');
    console.log(`✓ Файл .env создан из примера`);
  } catch (e) {
    console.error(`❌ Не удалось создать файл .env: ${e.message}`);
  }
} else if (!fs.existsSync(envPath)) {
  try {
    // Создаем минимальный .env файл если нет примера
    const minimalEnv = `# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=
TELEGRAM_GROUP_LINK=https://t.me/your_group_link
ADMIN_TG_ID=
ADMIN_TG_IDS=
TG_CHAT_ID=

# Database
DB_PATH=.data/database.sqlite

# Force approved users for testing (comma separated IDs)
FORCE_APPROVED_USERS=
`;
    fs.writeFileSync(envPath, minimalEnv, 'utf8');
    console.log(`✓ Минимальный файл .env создан`);
  } catch (e) {
    console.error(`❌ Не удалось создать минимальный файл .env: ${e.message}`);
  }
}

console.log('\nДля нормальной работы приложения заполните переменные окружения в файле .env');
console.log('Для проверки настроек запустите: node check-env.js'); 