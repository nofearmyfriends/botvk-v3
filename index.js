require('dotenv').config();

// Глобальная обработка необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА - Необработанное исключение:');
  console.error(error);
  
  // Логируем стек вызовов
  console.error('Стек вызовов:');
  console.error(error.stack);
  
  // Записываем в файл
  try {
    const fs = require('fs');
    const path = require('path');
    const errorLogDir = path.join(__dirname, 'logs');
    
    // Создаем директорию, если её нет
    if (!fs.existsSync(errorLogDir)) {
      fs.mkdirSync(errorLogDir, { recursive: true });
    }
    
    const now = new Date();
    const errorLogPath = path.join(errorLogDir, `error-${now.toISOString().replace(/:/g, '-')}.log`);
    
    const errorInfo = `
====== КРИТИЧЕСКАЯ ОШИБКА ======
Время: ${now.toISOString()}
Тип: ${error.name}
Сообщение: ${error.message}
Стек вызовов:
${error.stack}
============================
`;
    
    fs.writeFileSync(errorLogPath, errorInfo);
    console.error(`Журнал ошибки сохранен в: ${errorLogPath}`);
  } catch (logError) {
    console.error('Не удалось записать журнал ошибки:', logError);
  }
  
  // Приложение не должно упасть полностью из-за одной ошибки
  // Но мы отмечаем, что произошла критическая ошибка
  console.error('Приложение продолжает работу после критической ошибки');
});

// Обработка отклоненных промисов без обработчика
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанное отклонение Promise:');
  console.error('Promise:', promise);
  console.error('Причина:', reason);
  
  // Логирование в файл
  try {
    const fs = require('fs');
    const path = require('path');
    const errorLogDir = path.join(__dirname, 'logs');
    
    // Создаем директорию, если её нет
    if (!fs.existsSync(errorLogDir)) {
      fs.mkdirSync(errorLogDir, { recursive: true });
    }
    
    const now = new Date();
    const errorLogPath = path.join(errorLogDir, `unhandled-${now.toISOString().replace(/:/g, '-')}.log`);
    
    let reasonStr = '';
    if (reason instanceof Error) {
      reasonStr = `${reason.name}: ${reason.message}\n${reason.stack}`;
    } else {
      reasonStr = String(reason);
    }
    
    const errorInfo = `
====== UNHANDLED PROMISE REJECTION ======
Время: ${now.toISOString()}
Причина:
${reasonStr}
============================
`;
    
    fs.writeFileSync(errorLogPath, errorInfo);
    console.error(`Журнал отклонения сохранен в: ${errorLogPath}`);
  } catch (logError) {
    console.error('Не удалось записать журнал отклонения:', logError);
  }
});

const db = require('./db');
const tgBot = require('./tg-bot');
const cron = require('./cron');
const selfPing = require('./self-ping');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

// Запуск приложения
async function startApp() {
  try {
    console.log('🚀 Запуск приложения на CodeSandbox...');
    
    // Инициализация базы данных
    console.log('📊 Инициализация базы данных...');
    await db.initDatabase();
    
    // Запуск резервного копирования
    console.log('💾 Настройка автоматического резервного копирования...');
    db.scheduleBackups(24, 7); // раз в день, хранить 7 дней
    
    // Запуск системы мониторинга
    console.log('🔍 Запуск системы мониторинга...');
    const utils = require('./utils');
    utils.monitoring.startMonitoring(300000); // проверка раз в 5 минут
    
    // Запускаем синхронизацию списка пользователей из VK
    if (process.env.ENABLE_VK_SYNC === 'true') {
      console.log('🔄 Включена синхронизация списка пользователей из VK');
      utils.scheduleUsersSync(6); // Синхронизация каждые 6 часов
    } else {
      console.log('⏸️ Синхронизация списка пользователей из VK отключена');
    }
    
    // Запуск ВК бота
    console.log('🎭 Запуск VK бота...');
    console.log('resolved vk-bot', require.resolve('./vk-bot'));

    const vkBotModule = require('./vk-bot');
    console.log('=== Экспорт vk-bot ===', vkBotModule);

    if (typeof vkBotModule.startVkBot === 'function') {
      await vkBotModule.startVkBot();
    } else {
      console.error('❌ startVkBot отсутствует – VK-бот не запущен');
    }
    
    // Запуск Telegram бота
    console.log('🤖 Запуск Telegram бота...');
    await tgBot.startTgBot();
    
    // Запуск ежедневной проверки подписок
    console.log('⏰ Настройка ежедневной проверки подписок...');
    cron.scheduleDailyCheck();
    
    // Запуск еженедельной очистки сообщений
    console.log('🧹 Настройка еженедельной очистки сообщений...');
    cron.scheduleWeeklyCleanup();
    
    // Запуск системы самопинга для предотвращения засыпания
    console.log('🔄 Запуск системы самопинга...');
    selfPing.startSelfPing();
    
    // Создание директории для логов, если её нет
    const fs = require('fs');
    const path = require('path');
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
      console.log('📁 Создана директория для логов:', logsDir);
    }
    
    console.log('✅ Приложение успешно запущено');
    
    // Записываем информацию о запуске в лог
    const startupInfo = `
====== ЗАПУСК ПРИЛОЖЕНИЯ ======
Время: ${new Date().toISOString()}
Версия Node: ${process.version}
Платформа: ${process.platform}
Хостинг: CodeSandbox
Uptime: ${process.uptime()} сек
============================
`;
    
    fs.writeFileSync(path.join(logsDir, `startup-${new Date().toISOString().replace(/:/g, '-')}.log`), startupInfo);
    
    // Отправляем первый ежедневный отчет
    try {
      const tgBot = require('./tg-bot');
      if (tgBot && typeof tgBot.sendDailyStatusReport === 'function') {
        // Отправляем с небольшой задержкой, чтобы система загрузилась
        setTimeout(() => {
          tgBot.sendDailyStatusReport();
        }, 60000); // 1 минута
      }
    } catch (e) {
      console.error('❌ Ошибка отправки отчета при запуске:', e);
    }

    console.log('🎉 Система запущена на CodeSandbox')
    
  } catch (error) {
    console.error('❌ Критическая ошибка при запуске приложения:', error);
    console.error('Стек ошибки:', error.stack);
    
    // Записываем информацию об ошибке в лог
    try {
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.join(__dirname, 'logs');
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      const errorInfo = `
====== ОШИБКА ЗАПУСКА ======
Время: ${new Date().toISOString()}
Тип: ${error.name}
Сообщение: ${error.message}
Стек:
${error.stack}
============================
`;
      
      fs.writeFileSync(path.join(logsDir, `startup-error-${new Date().toISOString().replace(/:/g, '-')}.log`), errorInfo);
    } catch (logError) {
      console.error('Не удалось записать лог ошибки запуска:', logError);
    }
    
    process.exit(1);
  }
}

// VK Callback API confirmation - для подключения к группе ВК
app.post('/', (req, res) => {
  console.log('📞 Получен запрос VK Callback API:', req.body);
  
  if (req.body.type === 'confirmation') {
    // Используем код подтверждения из переменных окружения или дефолтный
    const confirmCode = process.env.VK_CONFIRMATION_CODE || '6100c54a';
    console.log('✅ Отправка кода подтверждения VK:', confirmCode);
    res.status(200).send(confirmCode);
  } else {
    console.log('👍 Подтверждение получения события VK');
    res.status(200).send('ok');
  }
});

// Обработка GET / — главная страница и health check
app.get('/', (req, res) => {
  const status = {
    status: 'ok',
    service: 'VK-TG Bot',
    hosting: 'CodeSandbox',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };
  res.status(200).json(status);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Порт для CodeSandbox (по умолчанию 3000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Express server запущен на порту ${PORT} (CodeSandbox)`);
  console.log(`📍 VK Callback API URL: https://your-sandbox-id.csb.app/`);
  
  // Запускаем упрощенный keep-alive для CodeSandbox
  startKeepAlive();
});

// Запуск приложения
startApp();

// --------------------------------------------------------------
// Упрощенный Keep-alive для CodeSandbox
// --------------------------------------------------------------
function startKeepAlive() {
  console.log('🔄 Keep-alive: запуск системы поддержания активности для CodeSandbox');
  
  const fs = require('fs');
  const path = require('path');
  
  // Интервал активности (каждые 4 минуты)
  const interval = Number(process.env.KEEP_ALIVE_INTERVAL_MS) || 240000;
  
  // Статистика для мониторинга
  const stats = {
    totalActivities: 0,
    fileActivities: 0,
    httpRequests: 0
  };
  
  // Основная функция поддержания активности
  const keepAlive = () => {
    try {
      // 1. Обновляем файл активности
      const tmpDir = path.join(__dirname, 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      const keepAliveFile = path.join(tmpDir, 'keep-alive.txt');
      const timestamp = new Date().toISOString();
      fs.writeFileSync(keepAliveFile, `Keep-alive: ${timestamp}\nHosting: CodeSandbox\n`);
      
      stats.fileActivities++;
      stats.totalActivities++;
      
      console.log(`🔄 Keep-alive активность: ${timestamp}`);
      
      // 2. Обновляем статус в мониторинге
      try {
        const utils = require('./utils');
        if (utils && utils.monitoring) {
          utils.monitoring.updateServiceStatus('keepAlive', true);
        }
      } catch (error) {
        console.log(`ℹ️ Keep-alive: ошибка обновления мониторинга: ${error.message}`);
      }
      
    } catch (error) {
      console.log(`ℹ️ Keep-alive: ошибка (игнорируется): ${error.message}`);
    }
  };
  
  // Запускаем активность каждые 4 минуты
  setInterval(keepAlive, interval);
  
  // Сразу запускаем первую активность
  setTimeout(keepAlive, 2000);
  
  // Статистика каждые 30 минут
  setInterval(() => {
    console.log(`📊 [Keep-alive статистика] Всего активностей: ${stats.totalActivities}, файловых: ${stats.fileActivities}`);
  }, 1800000);
  
  // Инициализируем статус в мониторинге
  try {
    const utils = require('./utils');
    if (utils && utils.monitoring) {
      utils.monitoring.updateServiceStatus('keepAlive', true);
    }
  } catch (error) {
    console.log(`ℹ️ Keep-alive: ошибка инициализации мониторинга: ${error.message}`);
  }
} 