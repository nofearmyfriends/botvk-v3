const selfPingModule = {
  lastMessageIds: {
    vk: [],
    telegram: []
  },
  
  // Запуск системы самопинга
  startSelfPing() {
    console.log('🔄 [САМОПИНГ] Запуск системы самопинга для предотвращения засыпания');
    console.log('📝 [САМОПИНГ] Интервал отправки сообщений: 2 часа');
    console.log('🧹 [САМОПИНГ] Интервал очистки сообщений: 4 часа');
    
    // Проверяем наличие необходимых переменных окружения
    if (!process.env.VK_GROUP_ID) {
      console.warn('⚠️ [САМОПИНГ] Не задан VK_GROUP_ID, самопинг VK может не работать');
    }
    
    if (!process.env.TG_CHAT_ID) {
      console.warn('⚠️ [САМОПИНГ] Не задан TG_CHAT_ID, самопинг Telegram может не работать');
      console.warn('⚠️ [САМОПИНГ] Добавьте TG_CHAT_ID в файл .env для корректной работы');
    }
    
    // Регистрация в системе мониторинга
    try {
      const utils = require('./utils');
      if (utils && utils.monitoring && typeof utils.monitoring.updateServiceStatus === 'function') {
        utils.monitoring.updateServiceStatus('selfPing', true);
      }
    } catch (error) {
      console.log(`ℹ️ [САМОПИНГ] Статус не добавлен в мониторинг: ${error.message}`);
    }
    
    // Добавляем небольшую задержку для инициализации ботов
    setTimeout(() => {
      try {
        this.pingVkBot();
      } catch (e) {
        console.error(`❌ [САМОПИНГ] Ошибка при запуске VK пинга: ${e.message}`);
      }
    }, 10000); // 10 секунд
    
    setTimeout(() => {
      try {
        this.pingTelegramBot();
      } catch (e) {
        console.error(`❌ [САМОПИНГ] Ошибка при запуске TG пинга: ${e.message}`);
      }
    }, 20000); // 20 секунд
    
    this.setupCleanup();
    
    // Первая очистка через час
    setTimeout(() => {
      try {
        this.cleanupMessages();
      } catch (e) {
        console.error(`❌ [САМОПИНГ] Ошибка при запуске очистки: ${e.message}`);
      }
    }, 60 * 60 * 1000);
  },
  
  // Пинг VK бота
  async pingVkBot() {
    try {
      console.log('🤖 [САМОПИНГ VK] Отправка сообщения...');
      
      // Безопасный импорт модуля
      let vkModule;
      try {
        vkModule = require('./vk-bot');
      } catch (importError) {
        console.error(`❌ [САМОПИНГ VK] Ошибка импорта модуля: ${importError.message}`);
        return; // Прерываем выполнение если не удалось импортировать
      }
      
      const botId = process.env.VK_BOT_ID || process.env.VK_GROUP_ID;
      
      if (botId && vkModule.vk) {
        // Текущее время в формате ЧЧ:ММ:СС
        const timeString = new Date().toLocaleTimeString();
        // Отправляем техническое сообщение
        const msg = `🔄 PING VK-бота ${timeString}`;
        console.log(`📩 [САМОПИНГ VK] Отправляемый текст: "${msg}"`);
        
        // Преобразуем ID в число и делаем отрицательным для сообщества
        const groupId = -Math.abs(Number(botId));
        console.log(`📩 [САМОПИНГ VK] Отправка в peer_id: ${groupId}`);
        
        const result = await vkModule.vk.api.messages.send({
          peer_id: groupId, // Отрицательный ID для сообщества
          message: msg,
          random_id: Math.floor(Math.random() * 1e9)
        });
        
        if (result) {
          this.lastMessageIds.vk.push(result);
          console.log(`✅ [САМОПИНГ VK] Успешно отправлено сообщение ID: ${result}`);
          
          // Храним только последние 100 ID сообщений
          if (this.lastMessageIds.vk.length > 100) {
            this.lastMessageIds.vk.shift();
          }
        }
      } else {
        console.log(`❌ [САМОПИНГ VK] Не удалось отправить: не задан ID бота или модуль не инициализирован`);
      }
    } catch (error) {
      console.error('❌ [САМОПИНГ VK] Ошибка:', error.message);
    }
    
    // Планируем следующий пинг
    const nextPingHours = 2;
    console.log(`⏰ [САМОПИНГ VK] Следующий пинг через ${nextPingHours} часа`);
    
    // Повторяем через 2 часа
    setTimeout(() => this.pingVkBot(), nextPingHours * 60 * 60 * 1000);
  },
  
  // Пинг Telegram бота
  async pingTelegramBot() {
    try {
      console.log('🤖 [САМОПИНГ TG] Отправка сообщения...');
      
      // Безопасный импорт модуля
      let tgModule;
      try {
        tgModule = require('./tg-bot');
      } catch (importError) {
        console.error(`❌ [САМОПИНГ TG] Ошибка импорта модуля: ${importError.message}`);
        return; // Прерываем выполнение если не удалось импортировать
      }
      
      // Используем TG_CHAT_ID вместо TELEGRAM_BOT_ID
      const chatId = process.env.TG_CHAT_ID;
      
      // Проверяем, что chatId задан и не является ID группы (группы имеют отрицательные ID)
      if (!chatId) {
        console.log(`❌ [САМОПИНГ TG] Не задан ID чата для отправки пингов`);
        return;
      }
      
      // Если ID начинается с минуса, это групповой чат - не отправляем туда пинги
      if (chatId.toString().startsWith('-')) {
        console.log(`❌ [САМОПИНГ TG] Указан ID группового чата (${chatId}). Пинги должны отправляться только администратору.`);
        return;
      }
      
      if (chatId && tgModule.bot) {
        // Текущее время в формате ЧЧ:ММ:СС
        const timeString = new Date().toLocaleTimeString();
        // Отправляем техническое сообщение
        const msg = `🔄 PING Telegram-бота ${timeString}`;
        console.log(`📩 [САМОПИНГ TG] Отправляемый текст: "${msg}"`);
        
        console.log(`📩 [САМОПИНГ TG] Отправка в chat_id: ${chatId}`);
        
        // Проверяем, что ADMIN_TG_ID задан и используем его вместо TG_CHAT_ID
        const adminId = process.env.ADMIN_TG_ID;
        if (adminId) {
          const result = await tgModule.bot.telegram.sendMessage(adminId, msg);
          
          if (result && result.message_id) {
            this.lastMessageIds.telegram.push({
              chat_id: adminId,
              message_id: result.message_id
            });
            
            console.log(`✅ [САМОПИНГ TG] Успешно отправлено сообщение ID: ${result.message_id}`);
            
            // Храним только последние 100 сообщений
            if (this.lastMessageIds.telegram.length > 100) {
              this.lastMessageIds.telegram.shift();
            }
          }
        } else {
          console.log(`❌ [САМОПИНГ TG] Не задан ID администратора (ADMIN_TG_ID) для отправки пингов`);
        }
      } else {
        console.log(`❌ [САМОПИНГ TG] Не удалось отправить: не задан ID чата или модуль не инициализирован`);
      }
    } catch (error) {
      console.error('❌ [САМОПИНГ TG] Ошибка:', error.message);
    }
    
    // Планируем следующий пинг
    const nextPingHours = 2;
    console.log(`⏰ [САМОПИНГ TG] Следующий пинг через ${nextPingHours} часа`);
    
    // Повторяем через 2 часа
    setTimeout(() => this.pingTelegramBot(), nextPingHours * 60 * 60 * 1000);
  },
  
  // Настройка очистки сообщений
  setupCleanup() {
    console.log('🔄 [САМОПИНГ] Настройка планировщика очистки сообщений');
    
    // Запускаем очистку каждые 4 часа
    setInterval(() => this.cleanupMessages(), 4 * 60 * 60 * 1000);
  },
  
  // Очистка накопленных сообщений
  async cleanupMessages() {
    console.log('🧹 [САМОПИНГ] Запуск очистки служебных сообщений');
    
    // Очистка VK сообщений
    try {
      console.log(`🧹 [САМОПИНГ VK] Очистка сообщений (количество: ${this.lastMessageIds.vk.length})`);
      
      // Безопасный импорт модуля
      let vkModule;
      try {
        vkModule = require('./vk-bot');
      } catch (importError) {
        console.error(`❌ [САМОПИНГ VK] Ошибка импорта модуля при очистке: ${importError.message}`);
        return; // Прерываем выполнение если не удалось импортировать
      }
      
      if (vkModule.vk && this.lastMessageIds.vk.length > 0) {
        // VK API не имеет массового удаления, удаляем по одному
        let deletedCount = 0;
        for (const messageId of this.lastMessageIds.vk) {
          try {
            await vkModule.vk.api.messages.delete({
              message_ids: messageId,
              delete_for_all: 1
            });
            deletedCount++;
          } catch (deleteError) {
            // Игнорируем ошибки при удалении
          }
        }
        console.log(`✅ [САМОПИНГ VK] Удалено ${deletedCount} из ${this.lastMessageIds.vk.length} сообщений`);
        this.lastMessageIds.vk = [];
      } else {
        console.log('ℹ️ [САМОПИНГ VK] Нет сообщений для удаления');
      }
    } catch (error) {
      console.error('❌ [САМОПИНГ VK] Ошибка очистки:', error.message);
    }
    
    // Очистка Telegram сообщений
    try {
      console.log(`🧹 [САМОПИНГ TG] Очистка сообщений (количество: ${this.lastMessageIds.telegram.length})`);
      
      // Безопасный импорт модуля
      let tgModule;
      try {
        tgModule = require('./tg-bot');
      } catch (importError) {
        console.error(`❌ [САМОПИНГ TG] Ошибка импорта модуля при очистке: ${importError.message}`);
        return;
      }
      
      if (tgModule.bot && this.lastMessageIds.telegram.length > 0) {
        let deletedCount = 0;
        for (const msg of this.lastMessageIds.telegram) {
          try {
            await tgModule.bot.telegram.deleteMessage(msg.chat_id, msg.message_id);
            deletedCount++;
          } catch (deleteError) {
            // Игнорируем ошибки при удалении
          }
        }
        console.log(`✅ [САМОПИНГ TG] Удалено ${deletedCount} из ${this.lastMessageIds.telegram.length} сообщений`);
        this.lastMessageIds.telegram = [];
      } else {
        console.log('ℹ️ [САМОПИНГ TG] Нет сообщений для удаления');
      }
    } catch (error) {
      console.error('❌ [САМОПИНГ TG] Ошибка очистки:', error.message);
    }
    
    // Планируем следующую очистку
    console.log('⏰ [САМОПИНГ] Следующая очистка через 4 часа');
  },

  // Получение статуса системы самопинга и диагностики
  async getStatusReport() {
    console.log('📊 [САМОПИНГ] Формирование отчета о состоянии системы');
    
    // Собираем информацию о системе
    const statusData = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      lastVkPings: this.lastMessageIds.vk.length,
      lastTgPings: this.lastMessageIds.telegram.length,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version
    };
    
    // Дополняем информацией о модулях
    try {
      const utils = require('./utils');
      if (utils && utils.monitoring) {
        statusData.monitoring = utils.monitoring.getFullStatusReport();
      }
    } catch (error) {
      statusData.monitoringError = error.message;
    }
    
    // Форматируем дату в локальном формате
    const now = new Date();
    const formattedDate = now.toLocaleString('ru-RU');
    
    // Форматируем отчет для человека
    const formattedReport = `
📊 <b>Отчет о состоянии самопинга:</b>
⏱️ Время работы: ${Math.floor(statusData.uptime / 3600)} ч ${Math.floor((statusData.uptime % 3600) / 60)} мин
💾 Использование памяти: ${Math.round(statusData.memory.rss / 1024 / 1024)} МБ
🤖 Отправлено пингов VK: ${statusData.lastVkPings} (с момента последней очистки)
🤖 Отправлено пингов TG: ${statusData.lastTgPings} (с момента последней очистки)
⚙️ Версия Node.js: ${statusData.nodeVersion}
⏰ Дата формирования: ${formattedDate}
`;
    
    return {
      text: formattedReport,
      data: statusData
    };
  },

  // Тестовая функция для проверки системы самопинга без отправки сообщений в основной канал
  async testPingSystem(adminId) {
    console.log('🧪 [САМОПИНГ] Запуск тестовой проверки системы самопинга');
    
    // Проверяем доступность модулей
    let vkModuleAvailable = false;
    let tgModuleAvailable = false;
    
    try {
      const vkModule = require('./vk-bot');
      // Проверяем наличие vk объекта или API
      vkModuleAvailable = !!vkModule && (!!vkModule.vk || !!vkModule.api || typeof vkModule.startVkBot === 'function');
      console.log('🧪 [САМОПИНГ] VK модуль проверен:', vkModuleAvailable);
    } catch (error) {
      console.error('❌ [САМОПИНГ] Ошибка при проверке VK модуля:', error.message);
    }
    
    try {
      const tgModule = require('./tg-bot');
      tgModuleAvailable = !!tgModule && !!tgModule.bot;
      console.log('🧪 [САМОПИНГ] TG модуль проверен:', tgModuleAvailable);
    } catch (error) {
      console.error('❌ [САМОПИНГ] Ошибка при проверке TG модуля:', error.message);
    }
    
    // Возвращаем результат проверки
    return {
      vkModuleAvailable,
      tgModuleAvailable,
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = selfPingModule; 