const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const utils = require('./utils');
require('dotenv').config();
const ExcelJS = require('exceljs');
const os = require('os');

/**
 * Форматирует количество дней в читаемый вид (1 день, 2 дня, 5 дней)
 * @param {number} days - Количество дней
 * @returns {string} - Отформатированная строка
 */
function formatDaysString(days) {
  if (days === 0) {
    return "менее 1 дн";
  }
  
  // Получаем последнюю цифру и последние две цифры
  const lastDigit = days % 10;
  const lastTwoDigits = days % 100;
  
  // Особые случаи для чисел от 11 до 19
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return `${days} дней`;
  }
  
  // Для чисел, заканчивающихся на 1 (кроме 11, что обработано выше)
  if (lastDigit === 1) {
    return `${days} день`;
  }
  
  // Для чисел, заканчивающихся на 2, 3, 4 (кроме 12, 13, 14, что обработаны выше)
  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${days} дня`;
  }
  
  // Для всех остальных случаев
  return `${days} дней`;
}

// Поддержка старых и новых названий переменных окружения
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN;
const GROUP_LINK = process.env.TELEGRAM_GROUP_LINK || process.env.TG_GROUP_LINK || 'https://t.me/your_group';

// Проверка наличия необходимых переменных окружения
if (!BOT_TOKEN) {
  console.error('Ошибка: Отсутствует переменная окружения TELEGRAM_BOT_TOKEN или TG_BOT_TOKEN');
  // Не выходим из процесса, чтобы остальные части приложения могли работать
  console.warn('Telegram бот будет работать в ограниченном режиме');
}

// Создание экземпляра бота
const bot = new Telegraf(BOT_TOKEN || 'test_token');

// Создаем глобальную защиту от спама как middleware
// Это позволит блокировать все сообщения от заблокированных пользователей
bot.use(async (ctx, next) => {
  // Пропускаем служебные обновления (не сообщения)
  if (!ctx.message) return next();
  
  // Пропускаем администраторов
  if (isAdmin(ctx.from.id)) return next();
  
  // Проверка блокировки в базе данных
  try {
    const isBlocked = await db.isUserBlocked(ctx.from.id);
    if (isBlocked) {
      console.log(`Заблокированный пользователь ${ctx.from.id} пытается отправить сообщение`);
      
      // Отправляем сообщение только раз в минуту, чтобы не флудить
      const now = Date.now();
      const lastNotificationKey = `last_block_notification_${ctx.from.id}`;
      const lastNotification = global[lastNotificationKey] || 0;
      
      if (now - lastNotification > 60000) { // раз в минуту
        await ctx.reply(`⛔ Вы заблокированы администратором. Сообщения не будут доставлены.`);
        global[lastNotificationKey] = now;
      }
      
      // Не вызываем next(), чтобы сообщение не обрабатывалось дальше
      return;
    }
  } catch (error) {
    console.error('Ошибка при проверке блокировки в БД:', error);
  }
  
  // Проверка блокировки в antiSpam
  if (utils.antiSpam.isBlocked(ctx.from.id)) {
    // Определяем, сколько времени осталось до разблокировки
    const timeLeft = Math.ceil(utils.antiSpam.getTimeToUnblock(ctx.from.id) / 60000);
    
    // Отправляем сообщение только раз в минуту, чтобы не флудить
    const now = Date.now();
    const lastNotificationKey = `last_block_notification_${ctx.from.id}`;
    const lastNotification = global[lastNotificationKey] || 0;
    
    if (now - lastNotification > 60000) { // раз в минуту
      await ctx.reply(`⛔ Вы временно заблокированы за спам. Блокировка снимется через ${timeLeft} мин.`);
      global[lastNotificationKey] = now;
    }
    
    // Не пропускаем сообщение дальше
    return;
  }
  
  // Проверка на спам-контент
  if (ctx.message.text && utils.antiSpam.checkSpamContent(ctx.message.text)) {
    console.warn(`Обнаружен спам-контент от пользователя ${ctx.from.id}: ${ctx.message.text}`);
    await ctx.reply('❌ Ваше сообщение содержит запрещенный контент.');
    utils.antiSpam.addWarning(ctx.from.id);
    return; // Не пропускаем сообщение дальше
  }
  
  // Проверка на флуд
  if (utils.antiSpam.checkSpam(ctx.from.id)) {
    const timeLeft = Math.ceil(utils.antiSpam.getTimeToUnblock(ctx.from.id) / 60000);
    await ctx.reply(`🛑 Вы отправляете сообщения слишком часто. Временная блокировка на ${timeLeft} мин.`);
    return; // Не пропускаем сообщение дальше
  }
  
  // Если проверки пройдены, пропускаем сообщение дальше
  return next();
});

// Создаем клавиатуру для админов
const adminKeyboard = Markup.keyboard([
  ['👤 Сообщения пользователей', '📊 Список донов'],
  ['🔄 Проверка самопинга', '❌ Завершить диалог']
]).resize();

// Клавиатура для меню сообщений пользователей
const adminMessagesKeyboard = Markup.keyboard([
  ['📨 Новые сообщения', '📝 Все сообщения'],
  ['🔙 Назад']
]).resize();

// Стандартная клавиатура с кнопкой перезапуска для обычных пользователей
const restartInline = Markup.inlineKeyboard([
  Markup.button.callback('🔄 Перезапуск', 'restart')
]);

// Функция для проверки, находится ли пользователь в канале
async function isUserInChannel(userId) {
  try {
    const chatId = process.env.TG_CHAT_ID;
    if (!chatId) {
      console.error('TG_CHAT_ID не установлен в .env');
      return false;
    }
    
    try {
      // Проверяем, является ли пользователь участником группы
      const chatMember = await bot.telegram.getChatMember(chatId, userId);
      console.log(`Статус пользователя ${userId} в канале ${chatId}: ${chatMember.status}`);
      return ['creator', 'administrator', 'member'].includes(chatMember.status);
    } catch (error) {
      // Если произошла ошибка при проверке - пользователь точно не в группе
      console.log(`Ошибка при проверке пользователя ${userId} в канале: ${error.message}`);
      return false;
    }
  } catch (error) {
    console.error(`Ошибка при проверке нахождения пользователя в канале: ${error}`);
    return false;
  }
}

// Функция приветствия /start с учётом статуса пользователя
async function handleStart(ctx) {
  try {
    // Сохраняем информацию о пользователе
    await saveTelegramUserInfo(ctx.from);
    
    const alreadyRegistered = await db.isTgUserRegistered(ctx.from.id);
    const isAdminUser = isAdmin(ctx.from.id);
    const userInChannel = await isUserInChannel(ctx.from.id);
    
    // Показываем админ-клавиатуру, если это админ
    if (isAdminUser) {
      // Проверяем, есть ли активный диалог у админа
      const activeDialog = await db.getAdminActiveDialog(ctx.from.id);
      if (activeDialog) {
        const userName = activeDialog.username || 
                        (activeDialog.first_name && `${activeDialog.first_name} ${activeDialog.last_name || ''}`.trim()) || 
                        `Пользователь ${activeDialog.user_id}`;
        
        await ctx.reply(`У вас активный диалог с ${userName}`, adminKeyboard);
      } else {
        await ctx.reply('Панель администратора:', adminKeyboard);
      }
    }
    
    if (alreadyRegistered && userInChannel) {
      // Пользователь зарегистрирован и находится в канале
      await ctx.reply('Вы уже вступили в канал!');
    } else {
      // Для всех пользователей не в канале (независимо от регистрации) показываем одинаковое приветствие
      await ctx.reply(
        'Вас приветствует👋 бот закрытого ТГ сообщества Nektar privat🔞.\n\n' +
        'Подайте заявку на вступление, введя уникальный одноразовый код доступа👇.'
      );
    }
  } catch (e) {
    console.error('Ошибка в /start:', e);
  }
}

// Обработка команды /start
bot.start(handleStart);

// Обработка команды /help
bot.help(async (ctx) => {
  await ctx.reply(
    'Для доступа в закрытое сообщество введите код, полученный после оплаты в ВК боте. ' +
    'Код должен состоять из 9 или более цифр.',
    restartInline
  );
});



// Команда для проверки статуса самопинга
bot.command(['ping', 'ping_status'], async (ctx) => {
  try {
    console.log('Получена команда ping от пользователя:', ctx.from.id);
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('🔄 Проверка статуса системы самопинга...');
      
      // Получаем модуль самопинга
      const selfPing = require('./self-ping');
      const statusReport = await selfPing.getStatusReport();
      
      await ctx.reply(statusReport.text, { parse_mode: 'HTML' });
      
      // Дополнительно отправляем команду пинга для проверки работы
      const adminId = ctx.from.id;
      const testResult = await selfPing.testPingSystem(adminId);
      
      const statusText = `
<b>✅ Проверка системы самопинга:</b>
🤖 VK модуль: ${testResult.vkModuleAvailable ? '✅ Доступен' : '❌ Недоступен'}
🤖 Telegram модуль: ${testResult.tgModuleAvailable ? '✅ Доступен' : '❌ Недоступен'}
⏰ Время проверки: ${new Date(testResult.timestamp).toLocaleString('ru-RU')}
`;
      
      await ctx.reply(statusText, { parse_mode: 'HTML' });
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при выполнении команды /ping_status:', error);
    await ctx.reply(`Произошла ошибка при выполнении команды: ${error.message}`);
  }
});

// Команда для проверки и обновления информации о пользователе по коду
bot.command('check_user', async (ctx) => {
  try {
    console.log('Получена команда check_user от пользователя:', ctx.from.id);
    
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('⛔ У вас нет доступа к этой команде');
      return;
    }
    
    // Получаем код из сообщения
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      await ctx.reply(
        'Использование: /check_user КОД_ДОСТУПА\n\n' +
        'Пример: /check_user 062730647\n\n' +
        'Эта команда проверяет информацию о пользователе по его коду доступа.'
      );
      return;
    }
    
    const accessKey = args[1].trim();
    
    // Проверяем код в базе данных
    const keyData = await db.checkAccessKey(accessKey);
    if (!keyData || !keyData.exists) {
      await ctx.reply(`❌ Код ${accessKey} не найден в базе данных`);
      return;
    }
    
    // Формируем информацию о пользователе
    const vkInfo = await db.getVkUserInfo(keyData.vk_id).catch(() => null);
    const vkUserName = vkInfo ? `${vkInfo.first_name} ${vkInfo.last_name}` : `ID: ${keyData.vk_id}`;
    
    // Проверяем, есть ли пользователь в кэше
    const cachedUsers = await db.getCachedUsers();
    const inCache = cachedUsers.find(d => d.vk_id === keyData.vk_id);
    
    let message = `ℹ️ Информация о пользователе:\n\n` +
                 `👤 VK: ${vkUserName}\n` +
                 `🔑 Код: ${accessKey}\n` +
                 `📅 Дата: ${keyData.payment_date || 'Не указана'}\n` +
                 `🔄 Использован: ${keyData.used ? 'Да' : 'Нет'}\n`;
    
    // Если пользователя нет в кэше, предлагаем добавить
    if (!inCache) {
      await ctx.reply(message, Markup.inlineKeyboard([
        Markup.button.callback('✅ Да, добавить', `add_user_${keyData.vk_id}_${accessKey}`)
      ]));
    } else {
      await ctx.reply(message);
    }
  } catch (error) {
    console.error('Ошибка при выполнении команды /check_user:', error);
    await ctx.reply(`❌ Произошла ошибка: ${error.message}`);
  }
});

// Команда для принудительной отправки отчета о состоянии
bot.command(['report', 'status'], async (ctx) => {
  try {
    console.log('Получена команда report от пользователя:', ctx.from.id);
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('🔄 Формирование и отправка отчета о состоянии системы...');
      
      // Принудительно отправляем отчет всем админам
      const result = await sendDailyStatusReport(true);
      
      if (result) {
        await ctx.reply('✅ Отчет успешно сформирован и отправлен всем администраторам');
      } else {
        await ctx.reply('❌ Произошла ошибка при формировании или отправке отчета');
      }
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при выполнении команды /report:', error);
    await ctx.reply(`Произошла ошибка при выполнении команды: ${error.message}`);
  }
});



// Обработчики для кнопок администратора по работе с сообщениями
bot.hears('👤 Сообщения пользователей', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('Меню управления сообщениями пользователей:', adminMessagesKeyboard);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при открытии меню сообщений:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

bot.hears('🔙 Назад', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('Панель администратора:', adminKeyboard);
    } else {
      await handleStart(ctx);
    }
  } catch (error) {
    console.error('Ошибка при возврате в главное меню:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

// Обработчик кнопки проверки самопинга
bot.hears('🔄 Проверка самопинга', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      console.log('Запрошена проверка самопинга через кнопку от пользователя:', ctx.from.id);
      const selfPing = require('./self-ping');
      const statusReport = await selfPing.getStatusReport();
      
      await ctx.reply(statusReport.text, { parse_mode: 'HTML' });
      
      // Запускаем тестовый пинг
      await ctx.reply('🔄 Запускаю тестовую проверку работоспособности...');
      
      // Принудительно вызываем пинг, но только для тестирования, без отправки в основной канал
      try {
        // Вместо вызова обычных функций пинга, используем специальную тестовую функцию
        // Это предотвратит отправку сообщений в основной канал
        const adminId = ctx.from.id;
        const testResult = await selfPing.testPingSystem(adminId);
        
        const statusText = `
<b>✅ Проверка системы самопинга:</b>
🤖 VK модуль: ${testResult.vkModuleAvailable ? '✅ Доступен' : '❌ Недоступен'}
🤖 Telegram модуль: ${testResult.tgModuleAvailable ? '✅ Доступен' : '❌ Недоступен'}
⏰ Время проверки: ${new Date(testResult.timestamp).toLocaleString('ru-RU')}
`;
        
        await ctx.reply(statusText, { parse_mode: 'HTML' });
      } catch (pingError) {
        await ctx.reply(`❌ Ошибка при проверке системы самопинга: ${pingError.message}`);
      }
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при проверке самопинга:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

bot.hears('📨 Новые сообщения', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await showUnreadMessages(ctx);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при показе новых сообщений:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

bot.hears('📝 Все сообщения', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await showAllMessages(ctx);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при показе всех сообщений:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

bot.hears('❌ Завершить диалог', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await endDialog(ctx);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при завершении диалога:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

// Обработчик кнопки "Список донов"
bot.hears('📊 Список донов', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('🔄 Генерирую Excel файл со списком доноров...');
      
      // Вызываем функцию для создания и отправки Excel файла
      await generateAndSendDonorsExcel(ctx);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при генерации списка доноров:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

// Обработка callback запросов (для inline кнопок)
bot.action('restart', async (ctx) => {
  await ctx.answerCbQuery('Перезапуск...');
  await handleStart(ctx);
});

// Обработка действий со списком сообщений
bot.action(/^read_msg_(\d+)$/, async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой действия');
      return;
    }
    
    const messageId = ctx.match[1];
    await db.markMessageAsRead(messageId);
    await ctx.answerCbQuery('Сообщение отмечено как прочитанное');
    
    // Обновляем список сообщений
    await showUnreadMessages(ctx);
  } catch (error) {
    console.error('Ошибка при отметке сообщения как прочитанное:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

bot.action(/^dialog_user_(\d+)$/, async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой действия');
      return;
    }
    
    const userId = parseInt(ctx.match[1]);
    await startDialog(ctx, userId);
    await ctx.answerCbQuery('Диалог начат');
  } catch (error) {
    console.error('Ошибка при начале диалога с пользователем:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Обработка кнопки завершения диалога
bot.action('end_dialog', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой действия');
      return;
    }
    
    await endDialog(ctx);
    await ctx.answerCbQuery('Диалог завершен');
  } catch (error) {
    console.error('Ошибка при завершении диалога:', error);
    await ctx.answerCbQuery('Произошла ошибка при завершении диалога');
  }
});

// Обработка кнопок пагинации для непрочитанных сообщений
bot.action(/^unread_page_(\d+)$/, async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой действия');
      return;
    }
    
    const page = parseInt(ctx.match[1]);
    await ctx.answerCbQuery(`Загрузка страницы ${page + 1}`);
    await showUnreadMessages(ctx, page);
  } catch (error) {
    console.error('Ошибка при пагинации непрочитанных сообщений:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Обработка кнопок пагинации для всех сообщений
bot.action(/^all_page_(\d+)$/, async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой действия');
      return;
    }
    
    const page = parseInt(ctx.match[1]);
    await ctx.answerCbQuery(`Загрузка страницы ${page + 1}`);
    await showAllMessages(ctx, page);
  } catch (error) {
    console.error('Ошибка при пагинации всех сообщений:', error);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Хранилище для отслеживания сообщений от пользователей
const userMessageLimits = {
  users: new Map(), // Map для хранения счетчиков сообщений по пользователям
  globalCounter: 0,  // Глобальный счетчик сообщений
  lastResetTime: Date.now(), // Время последнего сброса счетчиков
  MAX_MESSAGES_PER_USER: 10, // Максимум сообщений от одного пользователя в минуту
  MAX_GLOBAL_MESSAGES: 50,  // Максимум сообщений всего в минуту
  RESET_INTERVAL: 60000,    // Интервал сброса счетчиков (1 минута)
  FIRST_WARNING_THRESHOLD: 5, // Порог для первого предупреждения
  COOL_DOWN_PERIOD: 120000   // Период "охлаждения" для блокированных пользователей (2 минуты)
};

// Функция для проверки и обновления лимитов сообщений
function checkMessageLimit(userId) {
  const now = Date.now();
  
  // Сбрасываем счетчики, если прошел интервал сброса
  if (now - userMessageLimits.lastResetTime > userMessageLimits.RESET_INTERVAL) {
    userMessageLimits.users.clear();
    userMessageLimits.globalCounter = 0;
    userMessageLimits.lastResetTime = now;
  }
  
  // Получаем или создаем запись для пользователя
  let userRecord = userMessageLimits.users.get(userId) || {
    count: 0,
    lastMessageTime: 0,
    warningSent: false,
    blockedUntil: 0
  };
  
  // Проверяем, не находится ли пользователь в периоде "охлаждения"
  if (userRecord.blockedUntil > now) {
    return {
      allowed: false,
      reason: "cool_down",
      timeRemaining: Math.ceil((userRecord.blockedUntil - now) / 1000)
    };
  }
  
  // Инкрементируем счетчики
  userRecord.count++;
  userMessageLimits.globalCounter++;
  
  // Проверяем глобальный лимит
  if (userMessageLimits.globalCounter > userMessageLimits.MAX_GLOBAL_MESSAGES) {
    return {
      allowed: false,
      reason: "global_limit"
    };
  }
  
  // Проверяем лимит для конкретного пользователя
  if (userRecord.count > userMessageLimits.MAX_MESSAGES_PER_USER) {
    // Устанавливаем период "охлаждения"
    userRecord.blockedUntil = now + userMessageLimits.COOL_DOWN_PERIOD;
    userMessageLimits.users.set(userId, userRecord);
    
    return {
      allowed: false,
      reason: "user_limit"
    };
  }
  
  // Если пользователь приближается к лимиту, отправляем предупреждение
  const needsWarning = userRecord.count >= userMessageLimits.FIRST_WARNING_THRESHOLD && !userRecord.warningSent;
  if (needsWarning) {
    userRecord.warningSent = true;
  }
  
  // Обновляем время последнего сообщения и сохраняем запись
  userRecord.lastMessageTime = now;
  userMessageLimits.users.set(userId, userRecord);
  
  return {
    allowed: true,
    warning: needsWarning,
    count: userRecord.count,
    max: userMessageLimits.MAX_MESSAGES_PER_USER
  };
}

// Обновляем обработчик текстовых сообщений
bot.on('text', async (ctx, next) => {
  const message = ctx.message.text.trim();
  
  // Если в сессии есть ожидание ввода причины блокировки
  if (ctx.session && ctx.session.awaitingBlockReason) {
    return next(); // Передаем управление следующему обработчику для блокировки
  }
  
  try {
    // Сохраняем информацию о пользователе
    await saveTelegramUserInfo(ctx.from);
    
    // Если пользователь администратор, пропускаем проверку лимитов
    if (isAdmin(ctx.from.id)) {
      // Обрабатываем команды админ-панели
      
      // Обработка команд блокировки/разблокировки
      if (message.startsWith('/block ')) {
        const params = message.split(' ');
        if (params.length >= 2) {
          const userId = parseInt(params[1]);
          const reason = params.slice(2).join(' ') || 'Не указана';
          
          await blockUserCommand(ctx, userId, reason);
          return;
        }
      }
      
      if (message.startsWith('/unblock ')) {
        const params = message.split(' ');
        if (params.length >= 2) {
          const userId = parseInt(params[1]);
          
          await unblockUserCommand(ctx, userId);
          return;
        }
      }
      
      if (message === '/blocked') {
        await showBlockedUsers(ctx);
        return;
      }
      
      // Проверяем, находится ли админ в режиме диалога с пользователем
      const activeDialog = await db.getAdminActiveDialog(ctx.from.id);
      if (activeDialog) {
        // Пересылаем сообщение от админа пользователю
        try {
          const safeMessage = escapeHtml(message);
          
          // Сохраняем сообщение от админа в базе данных
          await db.saveUserMessage({
            tg_id: activeDialog.user_id,
            message_text: message,
            message_id: ctx.message.message_id,
            message_type: 'text',
            from_admin: 1
          });
          
          await rateLimitedSendMessage(
            activeDialog.user_id,
            `<b>Сообщение от администратора:</b>\n\n${safeMessage}`,
            { 
              parse_mode: 'HTML',
              disable_web_page_preview: true
            }
          ).then(() => {
            ctx.reply('Сообщение отправлено пользователю');
          }).catch(async (error) => {
            console.error('Ошибка при пересылке сообщения пользователю:', error);
            
            if (error.description && (
                error.description.includes('blocked') || 
                error.description.includes('chat not found') ||
                error.description.includes('user is deactivated')
            )) {
              await ctx.reply(
                `❌ Не удалось отправить сообщение пользователю: ${error.description}\n` +
                `Возможно, пользователь заблокировал бота или удалил свой аккаунт.`
              );
              
              // Предлагаем завершить диалог
              await ctx.reply(
                'Рекомендуется завершить диалог с этим пользователем.',
                Markup.inlineKeyboard([
                  Markup.button.callback('❌ Завершить диалог', `end_dialog`)
                ])
              );
            } else {
              await ctx.reply(`Ошибка при отправке сообщения: ${error.message}`);
            }
          });
        } catch (error) {
          console.error('Критическая ошибка при пересылке сообщения:', error);
          await ctx.reply(`Критическая ошибка при отправке сообщения: ${error.message}`);
        }
        return;
      }
    } else {
      // Проверка лимита сообщений для обычных пользователей
      const limitCheck = checkMessageLimit(ctx.from.id);
      
      if (!limitCheck.allowed) {
        if (limitCheck.reason === "cool_down") {
          await ctx.reply(`⚠️ Вы отправили слишком много сообщений. Пожалуйста, подождите ${limitCheck.timeRemaining} секунд перед отправкой следующего сообщения.`);
          return;
        } else if (limitCheck.reason === "user_limit") {
          await ctx.reply("⚠️ Вы достигли лимита отправки сообщений. Пожалуйста, подождите некоторое время перед отправкой следующего сообщения.");
          return;
        } else if (limitCheck.reason === "global_limit") {
          await ctx.reply("⚠️ Системный лимит сообщений превышен. Пожалуйста, попробуйте позже.");
          return;
        }
      }
      
      // Отправляем предупреждение о приближении к лимиту
      if (limitCheck.warning) {
        await ctx.reply(`⚠️ Внимание! Вы отправили ${limitCheck.count} сообщений из ${limitCheck.max} допустимых в минуту.`);
      }
    }

    // Проверяем, заблокирован ли пользователь
    const isBlocked = await db.isUserBlocked(ctx.from.id);
    if (isBlocked && !isAdmin(ctx.from.id)) {
      // Тихо игнорируем сообщения от заблокированных пользователей
      return;
    }
    
    // Сохраняем сообщение пользователя в базе данных
    try {
      await db.saveUserMessage({
        tg_id: ctx.from.id,
        message_text: message,
        message_id: ctx.message.message_id,
        message_type: 'text'
      });
      
      // Уведомляем администраторов о новом сообщении
      if (!isAdmin(ctx.from.id)) {
        notifyAdminsAboutNewMessage(ctx.from.id, message, 'text');
      }
    } catch (error) {
      console.error('Ошибка при сохранении сообщения:', error);
    }

    // Если пользователь уже зарегистрирован – проверяем, есть ли для него активный диалог с админом
    const registered = await db.isTgUserRegistered(ctx.from.id);
    
    if (registered && !isAdmin(ctx.from.id)) {
      // Проверяем, есть ли активный диалог админа с этим пользователем
      const adminDialogs = await getAllAdminDialogsWithUser(ctx.from.id);
      
      if (adminDialogs.length > 0) {
        // Пересылаем сообщение администраторам, которые в диалоге с пользователем
        for (const dialog of adminDialogs) {
          try {
            const userName = getUserDisplayName(ctx.from);
            const safeMessage = escapeHtml(message);
            await rateLimitedSendMessage(
              dialog.admin_id,
              `<b>Сообщение от ${userName}:</b>\n\n${safeMessage}`,
              { 
                parse_mode: 'HTML',
                disable_web_page_preview: true
              }
            ).catch(error => {
              console.error(`Ошибка при пересылке сообщения администратору ${dialog.admin_id}:`, error);
            });
          } catch (dialogError) {
            console.error(`Ошибка при пересылке сообщения администратору ${dialog.admin_id}:`, dialogError);
          }
        }
        return;
      }
      
      // Проверяем, находится ли пользователь в канале
      const userInChannel = await isUserInChannel(ctx.from.id);
      
      // Если пользователь не находится в канале, проверяем является ли сообщение кодом доступа
      if (!userInChannel) {
        if (/^\d{9,}$/.test(message)) {
          try {
            // Проверяем ключ в базе данных
            const keyData = await db.checkAccessKeyWithUser(message, ctx.from.id);
            console.log(`Проверка кода ${message} для пользователя ${ctx.from.id}, результат:`, 
                keyData ? `Код найден (tg_id: ${keyData.tg_id}, vk_id: ${keyData.vk_id}, used: ${keyData.used})` : "Код не найден");
            
            if (keyData) {
              // Проверяем, связан ли код с другим пользователем
              if (keyData.tg_id && keyData.tg_id !== ctx.from.id) {
                await ctx.reply(
                  'Этот код уже используется другим пользователем.\n' +
                  'Пожалуйста, используйте код, который был выдан вам в VK боте.'
                );
                return;
              }

              // Помечаем ключ как использованный и связываем с Telegram ID
              if (!keyData.tg_id) {
                await db.updateKeyUsed(message, ctx.from.id);
                
                // Сохраняем информацию о пользователе Telegram в таблицу tg_users
                await saveTelegramUserInfo(ctx.from);
                
                // Обновляем кэш донов с информацией о пользователе Telegram
                try {
                  const userInfo = await bot.telegram.getChat(ctx.from.id);
                  if (userInfo && keyData.vk_id) {
                    // Обновляем информацию в кэше донов
                    await db.updateCachedDonorTgInfo(keyData.vk_id, ctx.from.id, getUserDisplayName(userInfo));
                  }
                } catch (error) {
                  console.error('Ошибка при обновлении информации о пользователе Telegram:', error);
                }
              }

              // Сначала отправляем сообщение о том, что пользователь в списке оплативших
              await ctx.reply('Вы есть в списке оплативших!');
              
              // Затем отправляем ссылку для подачи заявки и информацию о подтверждении
              await ctx.reply(`Подайте заявку на вступление по ссылке ${GROUP_LINK}\nИ ждите ее подтверждения!`);
              
              // Если это администратор, показываем админ-клавиатуру
              if (isAdmin(ctx.from.id)) {
                await ctx.reply('Панель администратора:', adminKeyboard);
              }
                    } else {
          await ctx.reply(
            'Код не найден или уже не действителен.\n' + 
            'Возможные причины:\n' +
            '1. Неверный код доступа\n' +
            '2. Вы уже не являетесь активным донатером VK\n\n' +
            'Решение: отправьте боту в VK сообщение "оплатил" для получения нового кода.'
          );
          return;
        }
          } catch (error) {
            console.error('Ошибка при проверке ключа:', error);
            await ctx.reply('Произошла ошибка при проверке кода. Пожалуйста, попробуйте позже.');
            return;
          }
        } else {
          await ctx.reply(
            'Вы уже зарегистрированы, но не находитесь в канале.\n' +
            'Пожалуйста, введите ваш уникальный код доступа для повторного вступления или получите новый код в VK боте.\n\n' +
            'Код должен состоять не менее чем из 9 цифр.'
          );
          return;
        }
      }
      
      // Если пользователь зарегистрирован и в канале, игнорируем любые другие сообщения
      return;
    }

    // Проверяем, является ли сообщение цифровым кодом длиной от 9 символов
    if (/^\d{9,}$/.test(message)) {
      try {
        // Проверяем ключ в базе данных
        const keyData = await db.checkAccessKeyWithUser(message, ctx.from.id);
        console.log(`Проверка кода ${message} для пользователя ${ctx.from.id}, результат:`, 
            keyData ? `Код найден (tg_id: ${keyData.tg_id}, vk_id: ${keyData.vk_id}, used: ${keyData.used})` : "Код не найден");
        
        if (keyData) {
          // Проверяем, связан ли код с другим пользователем
          if (keyData.tg_id && keyData.tg_id !== ctx.from.id) {
            await ctx.reply(
              'Этот код уже используется другим пользователем.\n' +
              'Пожалуйста, используйте код, который был выдан вам в VK боте.'
            );
            return;
          }

          // Помечаем ключ как использованный и связываем с Telegram ID
          if (!keyData.tg_id) {
            await db.updateKeyUsed(message, ctx.from.id);
            
            // Сохраняем информацию о пользователе Telegram в таблицу tg_users
            await saveTelegramUserInfo(ctx.from);
            
            // Обновляем кэш донов с информацией о пользователе Telegram
            try {
              const userInfo = await bot.telegram.getChat(ctx.from.id);
              if (userInfo && keyData.vk_id) {
                // Обновляем информацию в кэше донов
                await db.updateCachedDonorTgInfo(keyData.vk_id, ctx.from.id, getUserDisplayName(userInfo));
              }
            } catch (error) {
              console.error('Ошибка при обновлении информации о пользователе Telegram:', error);
            }
          }

          // Сначала отправляем сообщение о том, что пользователь в списке оплативших
          await ctx.reply('Вы есть в списке оплативших!');
          
          // Затем отправляем ссылку для подачи заявки и информацию о подтверждении
          await ctx.reply(`Подайте заявку на вступление по ссылке ${GROUP_LINK}\nИ ждите ее подтверждения!`);
          
          // Если это администратор, показываем админ-клавиатуру
          if (isAdmin(ctx.from.id)) {
            await ctx.reply('Панель администратора:', adminKeyboard);
          }
        } else {
          await ctx.reply(
            'Код не найден или уже не действителен.\n' + 
            'Возможные причины:\n' +
            '1. Неверный код доступа\n' +
            '2. Вы уже не являетесь активным донатером VK\n\n' +
            'Решение: отправьте боту в VK сообщение "оплатил" для получения нового кода.'
          );
        }
      } catch (error) {
        console.error('Ошибка при проверке ключа:', error);
        await ctx.reply('Произошла ошибка при проверке кода. Пожалуйста, попробуйте позже.');
      }
    } else {
      await ctx.reply('Введите корректный код доступа (не менее 9 цифр).');
    }
  } catch (generalError) {
    console.error('Общая ошибка при обработке сообщения:', generalError);
    try {
      await ctx.reply('Произошла непредвиденная ошибка при обработке сообщения.');
    } catch (replyError) {
      console.error('Невозможно отправить сообщение об ошибке пользователю:', replyError);
    }
  }
});

// Автоматическое одобрение запросов на вступление в канал
bot.on('chat_join_request', async (ctx) => {
  try {
    // Сохраняем информацию о пользователе
    await saveTelegramUserInfo(ctx.from);
    
    const isRegistered = await db.isTgUserRegistered(ctx.from.id);

    if (isRegistered) {
      // Пользователь прошёл верификацию (ввёл код) – одобряем
      await ctx.telegram.approveChatJoinRequest(ctx.chat.id, ctx.from.id);
      await notifyUserAdded(ctx.from.id);
    } else {
      // Нет записи в БД – отклоняем запрос и отправляем подсказку
      try {
        await ctx.telegram.declineChatJoinRequest(ctx.chat.id, ctx.from.id);
      } catch (e) {
        console.warn('Не удалось отклонить join_request:', e.message);
      }

      await bot.telegram.sendMessage(
        ctx.from.id,
        'Чтобы вступить в сообщество, сначала получите уникальный код в VK-боте и отправьте его здесь. ' +
        'После ввода кода повторно нажмите «Подать заявку».'
      );
    }
  } catch (e) {
    console.error('Ошибка при обработке chat_join_request:', e);
  }
});

// Уведомление пользователя о добавлении в группу
async function notifyUserAdded(tgId) {
  try {
    await bot.telegram.sendMessage(tgId, 'Вы добавлены в сообщество!');
  } catch (error) {
    console.error(`Ошибка при отправке уведомления пользователю ${tgId}:`, error);
  }
}

// Удаление пользователя из группы
async function kickUserFromGroup(tgId, chatId) {
  try {
    // Сначала уведомляем пользователя личным сообщением
    await bot.telegram.sendMessage(tgId, 'Подписка закончилась. Вы исключены из канала!');

    // Исключаем пользователя (API ≥6.5) — используем banChatMember вместо устаревшего kickChatMember
    await bot.telegram.banChatMember(chatId, tgId);

    // Сразу снимаем бан, чтобы при повторной оплате пользователь мог снова подать заявку
    try {
      await bot.telegram.unbanChatMember(chatId, tgId, { only_if_banned: true });
    } catch (e) {
      console.warn(`Не удалось снять бан с пользователя ${tgId}:`, e.message);
    }

    return true;
  } catch (error) {
    console.error(`Ошибка при исключении пользователя ${tgId}:`, error);
    return false;
  }
}

// Уведомление админа о необходимости удалить пользователя
async function notifyAdminToRemoveUser(users) {
  if (!users.length) return;

  try {
    const adminId = process.env.ADMIN_TG_ID;
    if (!adminId) return;

    const chunkSize = 40; // ограничиваем размер одного сообщения
    for (let i = 0; i < users.length; i += chunkSize) {
      const chunk = users.slice(i, i + chunkSize);
      let message = 'Необходимо удалить следующих пользователей:\n\n';

      chunk.forEach(user => {
        message += `Удалить tg://user?id=${user.tg_id} (TG) | id${user.vk_id} (VK)\n`;
      });

      await bot.telegram.sendMessage(adminId, message);
    }
  } catch (error) {
    console.error('Ошибка при отправке уведомления админу:', error);
  }
}

// Функция проверки администратора по Telegram ID
function isAdmin(userId) {
  // При тестировании всегда возвращаем true
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  
  const adminIds = process.env.ADMIN_TG_IDS ? 
    process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
    [];
  
  // Если ADMIN_TG_ID тоже задан, добавляем его в список администраторов
  if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
    adminIds.push(Number(process.env.ADMIN_TG_ID));
  }
  
  console.log('Проверка прав админа для', userId, 'Список админов:', adminIds);
  return adminIds.includes(Number(userId));
}



// Функция для показа всех непрочитанных сообщений
async function showUnreadMessages(ctx, page = 1) {
  try {
    const limit = 5; // количество сообщений на страницу
    const offset = (page - 1) * limit;
    
    // Получаем общее количество непрочитанных сообщений
    const totalCount = await db.getUnreadMessagesCount();
    
    // Получаем непрочитанные сообщения с пагинацией
    const messages = await db.getUnreadMessagesWithPagination(offset, limit);
    
    if (messages.length === 0) {
      await ctx.reply('Нет непрочитанных сообщений 😴');
      return;
    }
    
    // Формируем заголовок с информацией о текущей странице
    const totalPages = Math.ceil(totalCount / limit);
    await ctx.reply(`📥 <b>Непрочитанные сообщения</b> (страница ${page} из ${totalPages || 1})`, {
      parse_mode: 'HTML'
    });
    
    // Отправляем каждое сообщение отдельно с кнопками
    for (const message of messages) {
      const formattedMsg = formatMessageForAdmin(message);
      
      // Отправляем основное сообщение с кнопками
      await ctx.reply(formattedMsg.text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...formattedMsg.markup
      });
      
      // Если это медиафайл, отправляем его после текстового сообщения
      if (message.file_id) {
        try {
          switch (message.message_type) {
            case 'photo':
              await ctx.replyWithPhoto(message.file_id);
              break;
            case 'video':
              await ctx.replyWithVideo(message.file_id);
              break;
            case 'document':
              await ctx.replyWithDocument(message.file_id);
              break;
            case 'voice':
              await ctx.replyWithVoice(message.file_id);
              break;
          }
        } catch (mediaError) {
          console.error(`Ошибка при отправке медиафайла: ${mediaError.message}`);
          await ctx.reply('⚠️ Не удалось загрузить медиафайл. Возможно, он был удален или срок его хранения истек.');
        }
      }
    }
    
    // Если есть несколько страниц, добавляем навигационные кнопки
    if (totalPages > 1) {
      const navButtons = [];
      
      if (page > 1) {
        navButtons.push(
          Markup.button.callback('⬅️ Предыдущая', `unread_page_${page-1}`)
        );
      }
      
      if (page < totalPages) {
        navButtons.push(
          Markup.button.callback('➡️ Следующая', `unread_page_${page+1}`)
        );
      }
      
      await ctx.reply('Навигация по страницам:', Markup.inlineKeyboard([navButtons]));
    }
    
    // Добавляем кнопку "Отметить все как прочитанные"
    if (messages.length > 0) {
      await ctx.reply(
        'Действия с непрочитанными сообщениями:',
        Markup.inlineKeyboard([
          Markup.button.callback('✅ Отметить все как прочитанные', 'mark_all_read')
        ])
      );
    }
  } catch (error) {
    console.error('Ошибка при показе непрочитанных сообщений:', error);
    await ctx.reply('Произошла ошибка при загрузке сообщений 😢');
  }
}

// Функция для показа всех сообщений
async function showAllMessages(ctx, page = 1) {
  try {
    const limit = 5; // количество сообщений на страницу
    const offset = (page - 1) * limit;
    
    // Получаем общее количество сообщений
    const totalCount = await db.getAllMessagesCount();
    
    // Получаем сообщения с пагинацией
    const messages = await db.getAllMessagesWithPagination(offset, limit);
    
    if (messages.length === 0) {
      await ctx.reply('Нет сообщений от пользователей 🤷‍♂️');
      return;
    }
    
    // Формируем заголовок с информацией о текущей странице
    const totalPages = Math.ceil(totalCount / limit);
    await ctx.reply(`📋 <b>Все сообщения</b> (страница ${page} из ${totalPages || 1})`, {
      parse_mode: 'HTML'
    });
    
    // Отправляем каждое сообщение отдельно с кнопками
    for (const message of messages) {
      const formattedMsg = formatMessageForAdmin(message);
      
      // Отправляем основное сообщение с кнопками
      await ctx.reply(formattedMsg.text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...formattedMsg.markup
      });
      
      // Если это медиафайл, отправляем его после текстового сообщения
      if (message.file_id) {
        try {
          switch (message.message_type) {
            case 'photo':
              await ctx.replyWithPhoto(message.file_id);
              break;
            case 'video':
              await ctx.replyWithVideo(message.file_id);
              break;
            case 'document':
              await ctx.replyWithDocument(message.file_id);
              break;
            case 'voice':
              await ctx.replyWithVoice(message.file_id);
              break;
          }
        } catch (mediaError) {
          console.error(`Ошибка при отправке медиафайла: ${mediaError.message}`);
          await ctx.reply('⚠️ Не удалось загрузить медиафайл. Возможно, он был удален или срок его хранения истек.');
        }
      }
    }
    
    // Если есть несколько страниц, добавляем навигационные кнопки
    if (totalPages > 1) {
      const navButtons = [];
      
      if (page > 1) {
        navButtons.push(
          Markup.button.callback('⬅️ Предыдущая', `all_page_${page-1}`)
        );
      }
      
      if (page < totalPages) {
        navButtons.push(
          Markup.button.callback('➡️ Следующая', `all_page_${page+1}`)
        );
      }
      
      await ctx.reply('Навигация по страницам:', Markup.inlineKeyboard([navButtons]));
    }
  } catch (error) {
    console.error('Ошибка при показе всех сообщений:', error);
    await ctx.reply('Произошла ошибка при загрузке сообщений 😢');
  }
}

// Начать диалог с пользователем
async function startDialog(ctx, userId) {
  try {
    const adminId = ctx.from.id;
    
    // Проверяем, существует ли пользователь в Telegram
    try {
      const user = await bot.telegram.getChat(userId).catch(() => null);
      if (!user) {
        await ctx.reply(`Ошибка: не удалось найти пользователя с ID ${userId} в Telegram.`);
        return;
      }
    } catch (userError) {
      console.error(`Ошибка при проверке пользователя ${userId}:`, userError);
      await ctx.reply(`Ошибка при проверке пользователя: ${userError.message}`);
      return;
    }
    
    // Проверяем, есть ли уже активный диалог у админа
    const activeDialog = await db.getAdminActiveDialog(adminId);
    if (activeDialog && activeDialog.user_id !== userId) {
      await ctx.reply(
        `У вас уже есть активный диалог с другим пользователем.\n` +
        `Завершите текущий диалог с помощью кнопки "❌ Завершить диалог" или команды /end`
      );
      return;
    }
    
    // Проверяем, не ведет ли кто-то уже диалог с этим пользователем
    const existingDialogs = await getAllAdminDialogsWithUser(userId);
    if (existingDialogs.length > 0) {
      // Если диалог ведет другой администратор
      if (!existingDialogs.some(dialog => dialog.admin_id === adminId)) {
        const adminInfo = await getAdminInfo(existingDialogs[0].admin_id);
        const adminName = adminInfo ? adminInfo.first_name || `Администратор #${adminInfo.id}` : `Администратор #${existingDialogs[0].admin_id}`;
        
        await ctx.reply(
          `С этим пользователем уже ведет диалог ${adminName}.\n` +
          `Дождитесь окончания диалога или обсудите передачу диалога с коллегой.`
        );
        return;
      }
    }
    
    // Создаем или обновляем запись о диалоге
    await db.createAdminDialog(adminId, userId);
    
    // Отмечаем все сообщения пользователя как прочитанные
    await db.markAllUserMessagesAsRead(userId);
    
    // Получаем историю сообщений пользователя
    const messages = await db.getUserMessageHistory(userId, 10);
    
    // Получаем информацию о пользователе
    const user = await bot.telegram.getChat(userId).catch(() => null);
    const userName = user ? getUserDisplayName(user) : `Пользователь ${userId}`;
    
    await ctx.reply(
      `Начат диалог с ${userName}.\n\n` +
      `Все ваши сообщения будут пересылаться пользователю.\n` +
      `Для завершения диалога используйте кнопку "❌ Завершить диалог" или команду /end`,
      adminKeyboard
    );
    
    // Если есть история сообщений, покажем её
    if (messages && messages.length > 0) {
      await ctx.reply(`История сообщений от ${userName}:`);
      
      // Отправляем последние 5 сообщений в обратном порядке (от старых к новым)
      const recentMessages = messages.slice(0, 5).reverse();
      for (const msg of recentMessages) {
        // Если это текстовое сообщение - отправляем текст
        if (msg.message_type === 'text' || !msg.file_id) {
          await ctx.reply(
            `<i>${new Date(msg.created_at).toLocaleString('ru-RU')}</i>\n\n${escapeHtml(msg.message_text)}`,
            { parse_mode: 'HTML' }
          );
        } else {
          // Для медиафайлов отправляем только текстовое сообщение
          await ctx.reply(
            `<i>${new Date(msg.created_at).toLocaleString('ru-RU')}</i>\n\n` +
            `${escapeHtml(msg.message_text)}\n\n` +
            `<i>Медиафайл типа "${msg.message_type}" (поддержка медиафайлов отключена)</i>`,
            { parse_mode: 'HTML' }
          );
        }
      }
    }
    
    // Уведомляем пользователя о начале диалога с администратором
    try {
      await bot.telegram.sendMessage(
        userId,
        '👨‍💼 <b>Администратор подключился к диалогу.</b>\n\n' +
        'Теперь вы можете общаться напрямую с администратором. ' +
        'Все ваши сообщения будут доставлены.',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Ошибка при отправке уведомления пользователю:', error);
      await ctx.reply(`Не удалось уведомить пользователя: ${error.message}`);
    }
  } catch (error) {
    console.error('Ошибка при начале диалога:', error);
    await ctx.reply('Произошла ошибка при начале диалога с пользователем');
  }
}

// Завершить диалог с пользователем
async function endDialog(ctx) {
  try {
    const adminId = ctx.from.id;
    
    // Проверяем, есть ли активный диалог
    const activeDialog = await db.getAdminActiveDialog(adminId);
    if (!activeDialog) {
      await ctx.reply('У вас нет активных диалогов');
      return;
    }
    
    // Закрываем диалог
    await db.closeAdminDialog(adminId, activeDialog.user_id);
    
    // Получаем информацию о пользователе
    const userName = activeDialog.username || 
                    (activeDialog.first_name && `${activeDialog.first_name} ${activeDialog.last_name || ''}`.trim()) || 
                    `Пользователь ${activeDialog.user_id}`;
    
    await ctx.reply(`Диалог с ${userName} завершен`, adminKeyboard);
    
    // Уведомляем пользователя о завершении диалога
    try {
      await bot.telegram.sendMessage(
        activeDialog.user_id,
        '👨‍💼 <b>Администратор завершил диалог.</b>\n\n' +
        'Если у вас появятся еще вопросы, напишите сообщение, и администратор получит уведомление.',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('Ошибка при отправке уведомления пользователю:', error);
      await ctx.reply(`Не удалось уведомить пользователя: ${error.message}`);
    }
  } catch (error) {
    console.error('Ошибка при завершении диалога:', error);
    await ctx.reply('Произошла ошибка при завершении диалога');
  }
}

// Получение списка активных диалогов админов с пользователем
async function getAllAdminDialogsWithUser(userId) {
  try {
    return await db.getAllAdminDialogsWithUser(userId);
  } catch (error) {
    console.error(`Ошибка при получении диалогов для пользователя ${userId}:`, error);
    return [];
  }
}

// Форматирование отображаемого имени пользователя
function getUserDisplayName(user) {
  if (!user) return 'Неизвестный пользователь';
  
  if (user.username) {
    return `@${user.username}` + (user.first_name ? ` (${user.first_name} ${user.last_name || ''})`.trim() : '');
  }
  
  if (user.first_name || user.last_name) {
    return `${user.first_name || ''} ${user.last_name || ''}`.trim();
  }
  
  return `Пользователь ${user.id}`;
}

// Форматирование отображаемого имени пользователя из записи сообщения
function getUserDisplayNameFromMessage(message) {
  if (!message) return 'Неизвестный пользователь';
  
  if (message.username) {
    return `@${message.username}` + (message.first_name ? ` (${message.first_name} ${message.last_name || ''})`.trim() : '');
  }
  
  if (message.first_name || message.last_name) {
    return `${message.first_name || ''} ${message.last_name || ''}`.trim();
  }
  
  return `Пользователь ${message.tg_id}`;
}

// Получение информации об администраторе
async function getAdminInfo(adminId) {
  try {
    return await bot.telegram.getChat(adminId);
  } catch (error) {
    console.error(`Ошибка при получении информации об администраторе ${adminId}:`, error);
    return null;
  }
}

// Экранирование HTML-тегов в сообщениях
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Форматирует сообщение пользователя для отображения администратору
 * @param {Object} message - Объект сообщения из базы данных
 * @param {boolean} showMarkReadButton - Показывать ли кнопку "Отметить прочитанным"
 * @returns {Object} - Объект с отформатированным текстом и разметкой
 */
function formatMessageForAdmin(message, showMarkReadButton = true) {
  if (!message) {
    return {
      text: '<i>Ошибка: сообщение не найдено</i>',
      markup: {}
    };
  }
  
  // Получаем отображаемое имя пользователя
  const userName = message.username ? 
    `@${message.username}` + (message.first_name ? ` (${message.first_name} ${message.last_name || ''})`.trim() : '') :
    (message.first_name || message.last_name) ? 
      `${message.first_name || ''} ${message.last_name || ''}`.trim() : 
      `Пользователь ${message.tg_id}`;
  
  // Форматируем дату
  const messageDate = new Date(message.created_at).toLocaleString('ru-RU');
  
  // Определяем статус сообщения
  const statusEmoji = message.is_read ? '✅' : '🆕';
  
  // Формируем заголовок сообщения
  let header = `${statusEmoji} <b>Сообщение от ${escapeHtml(userName)}</b>\n`;
  header += `🆔 ID: ${message.tg_id}\n`;
  header += `⏰ Дата: ${messageDate}\n`;
  
  // Определяем тип сообщения
  let messageTypeText = '';
  switch(message.message_type) {
    case 'photo':
      messageTypeText = '📷 Фото';
      break;
    case 'video':
      messageTypeText = '🎬 Видео';
      break;
    case 'document':
      messageTypeText = '📎 Документ';
      break;
    case 'voice':
      messageTypeText = '🎤 Голосовое сообщение';
      break;
    default:
      messageTypeText = '💬 Текст';
  }
  header += `📝 Тип: ${messageTypeText}\n\n`;
  
  // Добавляем текст сообщения
  const messageText = message.message_text ? escapeHtml(message.message_text) : '<i>Нет текста</i>';
  
  // Формируем кнопки
  const buttons = [];
  
  // Кнопка для начала диалога
  buttons.push([
    Markup.button.callback('🗣 Ответить', `dialog_user_${message.tg_id}`)
  ]);
  
  // Кнопка для просмотра истории сообщений
  buttons.push([
    Markup.button.callback('📜 История сообщений', `history_${message.tg_id}`)
  ]);
  
  // Кнопка для проверки статуса блокировки
  buttons.push([
    Markup.button.callback('ℹ️ Проверить статус блокировки', `check_block_status_${message.tg_id}`)
  ]);
  
  // Кнопка для пометки сообщения как прочитанное (если нужно)
  if (showMarkReadButton && !message.is_read) {
    buttons.push([
      Markup.button.callback('✅ Отметить прочитанным', `mark_read_${message.id}`)
    ]);
  }
  
  return {
    text: `${header}${messageText}`,
    markup: Markup.inlineKeyboard(buttons)
  };
}

// Обработка команды /end для завершения диалога
bot.command('end', async (ctx) => {
  if (isAdmin(ctx.from.id)) {
    await endDialog(ctx);
  } else {
    await ctx.reply('У вас нет прав для выполнения этой команды');
  }
});

// Добавляем команду для показа сообщений
bot.command('messages', async (ctx) => {
  try {
    if (isAdmin(ctx.from.id)) {
      await showUnreadMessages(ctx);
    } else {
      await ctx.reply('У вас нет прав для выполнения этой команды');
    }
  } catch (error) {
    console.error('Ошибка при выполнении команды /messages:', error);
    await ctx.reply('Произошла ошибка при выполнении команды');
  }
});

// Функция-заглушка для обработки медиафайлов (оставлена для совместимости)
async function handleMediaMessage(ctx, mediaType) {
  console.log(`Попытка отправки медиафайла типа ${mediaType} пользователем ${ctx.from.id}, но функционал отключен`);
  
  // Сохраняем информацию о пользователе
  await saveTelegramUserInfo(ctx.from);
  
  // Отправляем сообщение о том, что медиафайлы не поддерживаются
  await ctx.reply('⚠️ Отправка медиафайлов не поддерживается. Пожалуйста, отправьте текстовое сообщение.');
}

// Обработка фотографий
bot.on('photo', async (ctx) => {
  // Сохраняем информацию о пользователе
  await saveTelegramUserInfo(ctx.from);
  
  // Отправляем сообщение пользователю о том, что медиафайлы не поддерживаются
  await ctx.reply('⚠️ Отправка фотографий не поддерживается. Пожалуйста, отправьте текстовое сообщение.');
});

// Обработка видео
bot.on('video', async (ctx) => {
  // Сохраняем информацию о пользователе
  await saveTelegramUserInfo(ctx.from);
  
  // Отправляем сообщение пользователю о том, что медиафайлы не поддерживаются
  await ctx.reply('⚠️ Отправка видео не поддерживается. Пожалуйста, отправьте текстовое сообщение.');
});

// Обработка документов (файлов)
bot.on('document', async (ctx) => {
  // Сохраняем информацию о пользователе
  await saveTelegramUserInfo(ctx.from);
  
  // Отправляем сообщение пользователю о том, что медиафайлы не поддерживаются
  await ctx.reply('⚠️ Отправка документов не поддерживается. Пожалуйста, отправьте текстовое сообщение.');
});

// Обработка голосовых сообщений
bot.on('voice', async (ctx) => {
  // Сохраняем информацию о пользователе
  await saveTelegramUserInfo(ctx.from);
  
  // Отправляем сообщение пользователю о том, что медиафайлы не поддерживаются
  await ctx.reply('⚠️ Отправка голосовых сообщений не поддерживается. Пожалуйста, отправьте текстовое сообщение.');
});

// Обработка события выхода пользователя из канала/группы
bot.on('chat_member', async (ctx) => {
  try {
    // Проверяем, что это событие именно о выходе из нашего канала
    if (!ctx.chat || ctx.chat.id !== Number(process.env.TG_CHAT_ID)) {
      return;
    }
    
    // Проверяем статус участника
    const oldStatus = ctx.chatMember.old_chat_member?.status;
    const newStatus = ctx.chatMember.new_chat_member?.status;
    const userId = ctx.chatMember.new_chat_member?.user?.id || ctx.chatMember.from?.id;
    
    // Если пользователь покинул канал (был участником, стал не участником)
    if (oldStatus && ['member', 'administrator', 'creator'].includes(oldStatus) && 
        newStatus && ['left', 'kicked'].includes(newStatus)) {
      
      console.log(`Пользователь ${userId} покинул канал. Старый статус: ${oldStatus}, новый статус: ${newStatus}`);
      
      // Проверяем, был ли это добровольный выход или кик за неоплату
      if (newStatus === 'left') {
        // Пользователь вышел сам
        console.log(`Пользователь ${userId} добровольно покинул канал`);
        
        // Проверяем статус подписки VK Donut
        const userKey = await db.getUserKeyByTgId(userId);
        if (userKey && userKey.vk_id) {
          const utils = require('./utils');
          const hasActiveSubscription = await utils.checkVkDonutPayment(userKey.vk_id);
          
          if (hasActiveSubscription) {
            // У пользователя активная подписка, но он вышел из канала
            console.log(`Пользователь ${userId} с активной подпиской VK Donut покинул канал`);
            // НЕ отправляем сообщение о завершении подписки
            // Можно просто уведомить о выходе из канала
            try {
              await bot.telegram.sendMessage(userId, 
                'Вы покинули канал. Ваша подписка VK Donut остается активной. ' +
                'Чтобы вернуться в канал, используйте ваш код доступа в боте.'
              );
            } catch (error) {
              console.error(`Не удалось отправить сообщение пользователю ${userId}:`, error);
            }
          }
        }
      } else if (newStatus === 'kicked') {
        // Пользователь был исключен (скорее всего за неоплату)
        console.log(`Пользователь ${userId} был исключен из канала`);
        // Сообщение о завершении подписки уже отправляется в функции kickUserFromGroup
      }
    }
  } catch (error) {
    console.error('Ошибка при обработке события chat_member:', error);
  }
});

// Функция для уведомления администраторов о новом сообщении от пользователя
async function notifyAdminsAboutNewMessage(userId, message, messageType) {
  console.log(`notifyAdminsAboutNewMessage вызвана: userId=${userId}, messageType=${messageType}`);
  
  try {
    // Получаем список админов из переменных окружения
    const adminIds = process.env.ADMIN_TG_IDS ? 
      process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
      [];
    
    // Если ADMIN_TG_ID тоже задан, добавляем его в список администраторов
    if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
      adminIds.push(Number(process.env.ADMIN_TG_ID));
    }
    
    if (adminIds.length === 0) return;
    
    // Получаем информацию о пользователе
    const user = await bot.telegram.getChat(userId).catch(() => null);
    const userName = user ? getUserDisplayName(user) : `Пользователь ${userId}`;
    
    // Кнопка для начала диалога с пользователем
    const inlineKeyboard = Markup.inlineKeyboard([
      Markup.button.callback('🗣 Ответить пользователю', `dialog_user_${userId}`)
    ]);
    
    const safeMessage = escapeHtml(message);
    
    // Отправляем уведомление всем админам, у которых нет активного диалога с пользователем
    for (const adminId of adminIds) {
      try {
        // Проверяем, есть ли активный диалог с этим пользователем у админа
        const activeDialog = await db.getAdminDialogBetween(adminId, userId).catch(() => null);
        
        if (!activeDialog) {
          await rateLimitedSendMessage(
            adminId,
            `📩 <b>Новое сообщение от ${userName}:</b>\n\n${safeMessage}`,
            { 
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              ...inlineKeyboard
            }
          );
        }
      } catch (adminError) {
        console.error(`Ошибка при отправке уведомления админу ${adminId}:`, adminError);
      }
    }
  } catch (error) {
    console.error('Ошибка при отправке уведомлений админам о новом сообщении:', error);
  }
}

// Заглушка для функции notifyAdminsAboutMedia (оставлена для совместимости)
async function notifyAdminsAboutMedia(userId, mediaType, caption) {
  console.log(`notifyAdminsAboutMedia вызвана: userId=${userId}, mediaType=${mediaType}, но функционал отключен`);
  
  try {
    // Получаем список админов из переменных окружения
    const adminIds = process.env.ADMIN_TG_IDS ? 
      process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
      [];
    
    // Если ADMIN_TG_ID тоже задан, добавляем его в список администраторов
    if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
      adminIds.push(Number(process.env.ADMIN_TG_ID));
    }
    
    if (adminIds.length === 0) return;
    
    // Получаем информацию о пользователе
    const user = await bot.telegram.getChat(userId).catch(() => null);
    const userName = user ? getUserDisplayName(user) : `Пользователь ${userId}`;
    
    // Кнопка для начала диалога с пользователем
    const inlineKeyboard = Markup.inlineKeyboard([
      Markup.button.callback('🗣 Ответить пользователю', `dialog_user_${userId}`)
    ]);
    
    // Определяем тип медиа на русском
    let mediaTypeRus = mediaType;
    switch(mediaType) {
      case 'photo': mediaTypeRus = 'фото'; break;
      case 'video': mediaTypeRus = 'видео'; break;
      case 'document': mediaTypeRus = 'документ'; break;
      case 'voice': mediaTypeRus = 'голосовое сообщение'; break;
    }
    
    // Отправляем только текстовое уведомление всем админам
    for (const adminId of adminIds) {
      try {
        await rateLimitedSendMessage(
          adminId,
          `📩 <b>Пользователь ${userName} пытался отправить ${mediaTypeRus}</b>\n\n` +
          `<i>Поддержка медиафайлов отключена в системе</i>`,
          { 
            parse_mode: 'HTML',
            ...inlineKeyboard
          }
        );
      } catch (adminError) {
        console.error(`Ошибка при отправке уведомления админу ${adminId}:`, adminError);
      }
    }
  } catch (error) {
    console.error('Ошибка при отправке уведомлений админам о попытке отправки медиафайла:', error);
  }
}

// Заглушка для функции пересылки медиафайлов (оставлена для совместимости)
async function forwardMediaToAdmins(adminDialogs, user, mediaType) {
  const userName = getUserDisplayName(user);
  
  for (const dialog of adminDialogs) {
    try {
      console.log(`Попытка пересылки медиафайла типа ${mediaType} от ${userName} администратору ${dialog.admin_id}, но функционал отключен`);
      
      // Отправляем только текстовое уведомление
      await rateLimitedSendMessage(
        dialog.admin_id,
        `📩 <b>Пользователь ${userName} пытался отправить медиафайл (${mediaType})</b>\n\n` +
        `<i>Поддержка медиафайлов отключена в системе</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error(`Ошибка при отправке уведомления администратору ${dialog.admin_id}:`, error);
    }
  }
}

// Команда для блокировки пользователя
async function blockUserCommand(ctx, userId, reason) {
  try {
    if (!userId || isNaN(userId)) {
      await ctx.reply('Ошибка: неверный формат ID пользователя');
      return;
    }
    
    // Проверяем, существует ли такой пользователь в базе
    const user = await bot.telegram.getChat(userId).catch(() => null);
    if (!user) {
      await ctx.reply(`Пользователь с ID ${userId} не найден в Telegram`);
      return;
    }
    
    // Блокируем пользователя
    await db.blockUser(userId, ctx.from.id, reason);
    
    // Завершаем все активные диалоги с этим пользователем
    const activeDialogs = await getAllAdminDialogsWithUser(userId);
    for (const dialog of activeDialogs) {
      await db.closeAdminDialog(dialog.admin_id, userId);
      
      // Уведомляем администратора, что диалог завершен
      if (dialog.admin_id !== ctx.from.id) {
        try {
          await bot.telegram.sendMessage(
            dialog.admin_id,
            `❌ <b>Диалог с пользователем ${getUserDisplayName(user)} был автоматически завершен.</b>\n` +
            `Причина: пользователь был заблокирован администратором.`,
            { parse_mode: 'HTML' }
          );
        } catch (error) {
          console.error(`Ошибка при отправке уведомления администратору ${dialog.admin_id}:`, error);
        }
      }
    }
    
    await ctx.reply(
      `✅ Пользователь ${getUserDisplayName(user)} заблокирован.\n` +
      `Причина: ${reason}`
    );
  } catch (error) {
    console.error('Ошибка при блокировке пользователя:', error);
    await ctx.reply(`Ошибка при блокировке пользователя: ${error.message}`);
  }
}

// Команда для разблокировки пользователя
async function unblockUserCommand(ctx, userId) {
  try {
    if (!userId || isNaN(userId)) {
      await ctx.reply('Ошибка: неверный формат ID пользователя');
      return;
    }
    
    // Проверяем, существует ли такой пользователь в базе
    const user = await bot.telegram.getChat(userId).catch(() => null);
    const userName = user ? getUserDisplayName(user) : `Пользователь ${userId}`;
    
    // Разблокируем пользователя
    const result = await db.unblockUser(userId);
    
    if (result.changes > 0) {
      await ctx.reply(`✅ Пользователь ${userName} разблокирован.`);
    } else {
      await ctx.reply(`❌ Пользователь ${userName} не был заблокирован.`);
    }
  } catch (error) {
    console.error('Ошибка при разблокировке пользователя:', error);
    await ctx.reply(`Ошибка при разблокировке пользователя: ${error.message}`);
  }
}

// Команда для просмотра заблокированных пользователей
async function showBlockedUsers(ctx) {
  try {
    const blockedUsers = await db.getBlockedUsers();
    
    if (blockedUsers.length === 0) {
      await ctx.reply('В системе нет заблокированных пользователей.');
      return;
    }
    
    let message = '<b>📋 Список заблокированных пользователей:</b>\n\n';
    
    for (let i = 0; i < blockedUsers.length; i++) {
      const user = blockedUsers[i];
      const userName = user.username ? `@${user.username}` : 
                      ((user.first_name || user.last_name) ? 
                        `${user.first_name || ''} ${user.last_name || ''}`.trim() : 
                        `ID: ${user.tg_id}`);
                        
      const adminName = user.admin_username ? `@${user.admin_username}` :
                       ((user.admin_first_name || user.admin_last_name) ?
                         `${user.admin_first_name || ''} ${user.admin_last_name || ''}`.trim() :
                         `ID: ${user.blocked_by}`);
      
      const reason = user.reason || 'Не указана';
      const date = new Date(user.created_at).toLocaleDateString('ru-RU');
      
      message += `${i+1}. <b>${userName}</b> (ID: ${user.tg_id})\n`;
      message += `   📅 Дата: ${date}\n`;
      message += `   👮 Заблокировал: ${adminName}\n`;
      message += `   ℹ️ Причина: ${escapeHtml(reason)}\n\n`;
      
      // Если сообщение становится слишком длинным, отправляем его и начинаем новое
      if (message.length > 3000 && i < blockedUsers.length - 1) {
        await ctx.reply(message, { parse_mode: 'HTML' });
        message = '<b>Продолжение списка заблокированных пользователей:</b>\n\n';
      }
    }
    
    // Добавляем инструкцию по разблокировке
    message += '\nДля разблокировки используйте команду:\n/unblock ID_ПОЛЬЗОВАТЕЛЯ';
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Ошибка при получении списка заблокированных пользователей:', error);
    await ctx.reply(`Ошибка при получении списка заблокированных пользователей: ${error.message}`);
  }
}

// Регистрируем дополнительные команды для блокировки
bot.command('block', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('У вас нет прав для выполнения этой команды');
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    await ctx.reply(
      'Использование: /block ID_ПОЛЬЗОВАТЕЛЯ [ПРИЧИНА]\n\n' +
      'Пример: /block 123456789 Спам в сообщениях'
    );
    return;
  }
  
  const userId = parseInt(args[0]);
  const reason = args.slice(1).join(' ') || 'Не указана';
  
  await blockUserCommand(ctx, userId, reason);
});

bot.command('unblock', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('У вас нет прав для выполнения этой команды');
    return;
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    await ctx.reply(
      'Использование: /unblock ID_ПОЛЬЗОВАТЕЛЯ\n\n' +
      'Пример: /unblock 123456789'
    );
    return;
  }
  
  const userId = parseInt(args[0]);
  await unblockUserCommand(ctx, userId);
});

bot.command('blocked', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('У вас нет прав для выполнения этой команды');
    return;
  }
  
  await showBlockedUsers(ctx);
});

// Обработчик кнопки блокировки пользователя
bot.action(/^block_user_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Проверяем, существует ли пользователь в Telegram
    let user;
    try {
      user = await bot.telegram.getChat(userId);
    } catch (error) {
      await ctx.reply(`Не удалось получить информацию о пользователе с ID ${userId}. Возможно, аккаунт удален.`);
      return;
    }
    
    // Получаем имя пользователя
    const userName = getUserDisplayName(user);
    
    // Спрашиваем подтверждение и причину блокировки
    await ctx.reply(
      `⚠️ Вы действительно хотите заблокировать пользователя ${userName} (ID: ${userId})?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, заблокировать', `confirm_block_${userId}`),
          Markup.button.callback('❌ Отмена', 'cancel_block')
        ]
      ])
    );
    
    // Сохраняем в сессии пользователя информацию для запроса причины блокировки
    if (!ctx.session) ctx.session = {};
    ctx.session.pendingBlockUser = userId;
    
  } catch (error) {
    console.error('Ошибка при обработке команды блокировки пользователя:', error);
    await ctx.reply('Произошла ошибка при обработке команды блокировки пользователя');
  }
});

// Обработчик отмены блокировки пользователя
bot.action('cancel_block', async (ctx) => {
  try {
    // Очищаем данные из сессии
    if (ctx.session) {
      delete ctx.session.pendingBlockUser;
    }
    
    // Сообщаем об отмене операции
    await ctx.reply('Операция блокировки пользователя отменена.');
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при отмене блокировки:', error);
    await ctx.reply('Произошла ошибка при отмене блокировки');
  }
});

// Обработчик подтверждения блокировки пользователя
bot.action(/^confirm_block_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Предлагаем выбрать причину блокировки из готовых вариантов
    await ctx.reply(
      'Выберите причину блокировки пользователя:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Спам', `block_reason_${userId}_spam`)],
        [Markup.button.callback('Оскорбления', `block_reason_${userId}_insult`)],
        [Markup.button.callback('Мошенничество', `block_reason_${userId}_scam`)],
        [Markup.button.callback('Нарушение правил', `block_reason_${userId}_rules`)],
        [Markup.button.callback('Другое', `block_reason_${userId}_other`)],
        [Markup.button.callback('❌ Отмена', 'cancel_block')]
      ])
    );
    
    await ctx.answerCbQuery('Выберите причину блокировки');
  } catch (error) {
    console.error('Ошибка при подтверждении блокировки:', error);
    await ctx.reply('Произошла ошибка при подтверждении блокировки');
  }
});

// Обработчик выбора причины блокировки
bot.action(/^block_reason_(\d+)_(.+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя и причину из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    const reasonCode = ctx.match[2];
    
    // Преобразуем код причины в читаемый текст
    let reason;
    switch (reasonCode) {
      case 'spam':
        reason = 'Спам';
        break;
      case 'insult':
        reason = 'Оскорбления';
        break;
      case 'scam':
        reason = 'Мошенничество';
        break;
      case 'rules':
        reason = 'Нарушение правил';
        break;
      case 'other':
        reason = 'Другая причина';
        break;
      default:
        reason = 'Не указана';
    }
    
    console.log(`Блокируем пользователя ${userId}, причина: ${reason}`);
    
    try {
      // Блокируем пользователя
      const blockResult = await db.blockUser(userId, ctx.from.id, reason);
      console.log('Результат блокировки:', blockResult);
      
      // Получаем информацию о пользователе для сообщения
      let userName = `Пользователь ${userId}`;
      try {
        const user = await bot.telegram.getChat(userId);
        userName = getUserDisplayName(user);
      } catch (error) {
        // Если не удалось получить информацию о пользователе, используем ID
        console.error(`Не удалось получить информацию о пользователе ${userId}:`, error);
      }
      
      // Завершаем все активные диалоги с пользователем
      const activeDialogs = await getAllAdminDialogsWithUser(userId);
      console.log(`Найдено ${activeDialogs.length} активных диалогов с пользователем ${userId}`);
      
      for (const dialog of activeDialogs) {
        await db.closeAdminDialog(dialog.admin_id, userId);
        
        // Уведомляем других администраторов о блокировке
        if (dialog.admin_id !== ctx.from.id) {
          try {
            await bot.telegram.sendMessage(
              dialog.admin_id,
              `❌ <b>Диалог с пользователем ${userName} был автоматически завершен.</b>\n` +
              `Причина: пользователь был заблокирован администратором ${getUserDisplayName(ctx.from)}.\n` +
              `Причина блокировки: ${escapeHtml(reason)}`,
              { parse_mode: 'HTML' }
            );
          } catch (error) {
            console.error(`Ошибка при отправке уведомления администратору ${dialog.admin_id}:`, error);
          }
        }
      }
      
      // Уведомляем о успешной блокировке
      await ctx.reply(
        `✅ Пользователь ${userName} успешно заблокирован.\n` +
        `Причина: ${escapeHtml(reason)}`
      );
      
    } catch (error) {
      console.error('Ошибка при блокировке пользователя:', error);
      await ctx.reply(`Ошибка при блокировке пользователя: ${error.message}`);
    }
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при обработке причины блокировки:', error);
    await ctx.reply('Произошла ошибка при блокировке пользователя');
  }
});

// Регистрируем обработчики страниц сообщений
bot.action(/^unread_page_(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  await showUnreadMessages(ctx, page);
  await ctx.answerCbQuery();
});

bot.action(/^all_page_(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  await showAllMessages(ctx, page);
  await ctx.answerCbQuery();
});

// Обработчик пометки сообщения как прочитанного
bot.action(/^mark_read_(\d+)$/, async (ctx) => {
  try {
    const messageId = ctx.match[1];
    await db.markMessageAsRead(messageId);
    await ctx.answerCbQuery('Сообщение отмечено как прочитанное');
    
    // Обновляем текст сообщения, удаляя кнопку "Отметить прочитанным"
    try {
      const messageObj = await db.getUserMessageById(messageId);
      if (messageObj) {
        const formattedMsg = formatMessageForAdmin(
          { ...messageObj, is_read: 1 }, // Клонируем объект и меняем флаг
          false // Не показывать кнопку прочитать
        );
        
        await ctx.editMessageText(formattedMsg.text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...formattedMsg.markup
        });
      }
    } catch (editError) {
      console.error('Ошибка при обновлении сообщения:', editError);
    }
  } catch (error) {
    console.error('Ошибка при отметке сообщения прочитанным:', error);
    await ctx.answerCbQuery('Ошибка при обновлении статуса сообщения');
  }
});

// Обработчик кнопки "Отметить все как прочитанные"
bot.action('mark_all_read', async (ctx) => {
  try {
    // Получаем ID пользователя из последнего отображаемого сообщения
    const messages = await db.getUnreadMessagesWithPagination(0, 100); // Получаем список непрочитанных
    
    if (messages && messages.length > 0) {
      // Создаем массив уникальных ID пользователей
      const userIds = [...new Set(messages.map(msg => msg.tg_id))];
      
      // Помечаем все сообщения для каждого пользователя как прочитанные
      for (const userId of userIds) {
        await db.markAllUserMessagesAsRead(userId);
      }
      
      await ctx.answerCbQuery('Все сообщения помечены как прочитанные');
      await ctx.reply('✅ Все непрочитанные сообщения помечены как прочитанные');
      
      // Обновляем список непрочитанных сообщений
      await showUnreadMessages(ctx);
    } else {
      await ctx.answerCbQuery('Нет непрочитанных сообщений');
      await ctx.reply('ℹ️ Нет непрочитанных сообщений для обработки');
    }
  } catch (error) {
    console.error('Ошибка при обработке массового изменения статуса сообщений:', error);
    await ctx.answerCbQuery('Произошла ошибка');
    await ctx.reply('❌ Ошибка при обработке сообщений. Пожалуйста, попробуйте позже.');
  }
});

// Обработчик запроса истории сообщений пользователя
bot.action(/^history_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли нажавший администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из данных кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Проверяем, не является ли запрашиваемый пользователь админом
    const adminIds = process.env.ADMIN_TG_IDS ? 
      process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
      [];
      
    // Если также задан ADMIN_TG_ID, добавляем его в список
    if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
      adminIds.push(Number(process.env.ADMIN_TG_ID));
    }
    
    // Если запрашивается история админа, показываем сообщение об ошибке
    if (adminIds.includes(userId)) {
      await ctx.reply('⚠️ Невозможно показать историю сообщений администратора');
      await ctx.answerCbQuery('Операция не поддерживается');
      return;
    }
    
    // Получаем информацию о пользователе
    const userInfo = await bot.telegram.getChat(userId).catch(() => null);
    const userName = userInfo ? getUserDisplayName(userInfo) : `Пользователь ${userId}`;
    
    // Сообщаем о начале загрузки истории
    await ctx.reply(`Загружаю историю сообщений пользователя ${userName}...`);
    
    // Получаем историю сообщений из базы данных
    const history = await db.getUserMessageHistory(userId);
    
    if (!history || history.length === 0) {
      await ctx.reply(`История сообщений для пользователя ${userName} не найдена`);
      return;
    }
    
    // Отображаем заголовок
    await ctx.reply(`📜 <b>История сообщений пользователя ${userName}</b> (${history.length} сообщений):`, {
      parse_mode: 'HTML'
    });
    
    // Отображаем последние 20 сообщений (или меньше, если их меньше)
    const messagesToShow = history.slice(Math.max(0, history.length - 20));
    
    // Отправляем сообщения группами по 5
    const groupSize = 5;
    for (let i = 0; i < messagesToShow.length; i += groupSize) {
      const batch = messagesToShow.slice(i, i + groupSize);
      
      // Обрабатываем каждое сообщение
      for (const message of batch) {
        // Форматируем дату и текст
        const messageDate = new Date(message.created_at).toLocaleString('ru');
        const safeText = escapeHtml(message.message_text);
        
        // Определяем эмодзи для типа сообщения
        let messageTypeEmoji = '';
        switch(message.message_type) {
          case 'photo':
            messageTypeEmoji = '📷 ';
            break;
          case 'video':
            messageTypeEmoji = '🎬 ';
            break;
          case 'document':
            messageTypeEmoji = '📎 ';
            break;
          case 'voice':
            messageTypeEmoji = '🎤 ';
            break;
        }
        
        // Отправляем текст сообщения
        await ctx.reply(
          `${messageTypeEmoji}<i>[${messageDate}]</i>\n\n${safeText}`,
          { parse_mode: 'HTML' }
        );
        
        // Если это медиафайл, отправляем его
        if (message.file_id) {
          try {
            switch(message.message_type) {
              case 'photo':
                await ctx.replyWithPhoto(message.file_id);
                break;
              case 'video':
                await ctx.replyWithVideo(message.file_id);
                break;
              case 'document':
                await ctx.replyWithDocument(message.file_id);
                break;
              case 'voice':
                await ctx.replyWithVoice(message.file_id);
                break;
            }
          } catch (mediaError) {
            console.error(`Ошибка при отправке медиафайла из истории: ${mediaError.message}`);
            await ctx.reply('⚠️ Не удалось загрузить медиафайл. Возможно, он был удален или срок его хранения истек.');
          }
        }
      }
      
      // Если не последняя группа, ждем немного перед отправкой следующей
      if (i + groupSize < messagesToShow.length) {
        await delay(300);
      }
    }
    
    // Если сообщений было отображено меньше, чем всего в истории
    if (messagesToShow.length < history.length) {
      await ctx.reply(
        `Показаны последние ${messagesToShow.length} сообщений из ${history.length}. ` +
        `Более старые сообщения не отображены.`
      );
    }
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при получении истории сообщений:', error);
    await ctx.reply('Произошла ошибка при получении истории сообщений');
    await ctx.answerCbQuery('Ошибка при получении истории');
  }
});

// Обработчик проверки статуса блокировки пользователя
bot.action(/^check_block_status_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Получаем информацию о пользователе
    let userName = `Пользователь ${userId}`;
    try {
      const user = await bot.telegram.getChat(userId);
      userName = getUserDisplayName(user);
    } catch (error) {
      console.error(`Не удалось получить информацию о пользователе ${userId}:`, error);
    }
    
    // Проверяем статус блокировки
    const isBlocked = await db.isUserBlocked(userId);
    console.log(`Проверка статуса блокировки для ${userName} (${userId}): ${isBlocked ? 'заблокирован' : 'не заблокирован'}`);
    
    // Создаем кнопки в зависимости от статуса блокировки
    let buttons;
    if (isBlocked) {
      buttons = [
        [Markup.button.callback('🔓 Разблокировать', `unblock_user_${userId}`)],
        [Markup.button.callback('🗣 Ответить', `dialog_user_${userId}`)],
        [Markup.button.callback('📜 История сообщений', `history_${userId}`)]
      ];
      
      await ctx.reply(
        `⚠️ Пользователь ${userName} заблокирован.\n\nВыберите действие:`,
        Markup.inlineKeyboard(buttons)
      );
    } else {
      buttons = [
        [Markup.button.callback('🚫 Заблокировать', `block_user_${userId}`)],
        [Markup.button.callback('🗣 Ответить', `dialog_user_${userId}`)],
        [Markup.button.callback('📜 История сообщений', `history_${userId}`)]
      ];
      
      await ctx.reply(
        `✅ Пользователь ${userName} не заблокирован.\n\nВыберите действие:`,
        Markup.inlineKeyboard(buttons)
      );
    }
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при проверке статуса блокировки:', error);
    await ctx.reply('Произошла ошибка при проверке статуса блокировки пользователя');
    await ctx.answerCbQuery('Ошибка при проверке статуса');
  }
});

// Обработчик разблокировки пользователя
bot.action(/^unblock_user_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Получаем информацию о пользователе
    let userName = `Пользователь ${userId}`;
    try {
      const user = await bot.telegram.getChat(userId);
      userName = getUserDisplayName(user);
    } catch (error) {
      console.error(`Не удалось получить информацию о пользователе ${userId}:`, error);
    }
    
    // Запрашиваем подтверждение разблокировки
    await ctx.reply(
      `Вы действительно хотите разблокировать пользователя ${userName}?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, разблокировать', `confirm_unblock_${userId}`),
          Markup.button.callback('❌ Отмена', 'cancel_unblock')
        ]
      ])
    );
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при подготовке разблокировки:', error);
    await ctx.reply('Произошла ошибка при подготовке разблокировки пользователя');
  }
});

// Обработчик отмены разблокировки
bot.action('cancel_unblock', async (ctx) => {
  await ctx.reply('Операция разблокировки отменена.');
  await ctx.answerCbQuery();
});

// Обработчик подтверждения разблокировки
bot.action(/^confirm_unblock_(\d+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('У вас нет прав для выполнения этой операции');
      return;
    }
    
    // Получаем ID пользователя из параметра кнопки
    const userId = parseInt(ctx.match[1]);
    
    // Получаем информацию о пользователе
    let userName = `Пользователь ${userId}`;
    try {
      const user = await bot.telegram.getChat(userId);
      userName = getUserDisplayName(user);
    } catch (error) {
      console.error(`Не удалось получить информацию о пользователе ${userId}:`, error);
    }
    
    // Разблокируем пользователя
    console.log(`Разблокируем пользователя ${userId}`);
    const result = await db.unblockUser(userId);
    console.log('Результат разблокировки:', result);
    
    if (result.changes > 0) {
      await ctx.reply(`✅ Пользователь ${userName} успешно разблокирован.`);
    } else {
      await ctx.reply(`⚠️ Пользователь ${userName} не был заблокирован или произошла ошибка.`);
    }
    
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Ошибка при разблокировке пользователя:', error);
    await ctx.reply('Произошла ошибка при разблокировке пользователя');
  }
});

/**
 * Сохраняет информацию о пользователе Telegram в базу данных
 * @param {Object} user - Объект пользователя Telegram
 * @returns {Promise<boolean>} - Результат операции
 */
async function saveTelegramUserInfo(user) {
  if (!user || !user.id) return false;
  
  try {
    // Используем функцию saveTelegramUser из модуля db вместо прямого вызова db.run
    await db.saveTelegramUser(user);
    return true;
  } catch (error) {
    console.error('Ошибка при сохранении/обновлении данных пользователя Telegram:', error);
    return false;
  }
}

/**
 * Рассчитывает продолжительность подписки в человекочитаемом формате
 * @param {Date|Number|String} firstDateOrDays - Дата первого платежа, количество дней подписки или строка с датой
 * @returns {string} - Форматированная строка продолжительности
 */
function calculateDuration(firstDateOrDays) {
  // Если передано число, это количество дней подписки
  if (typeof firstDateOrDays === 'number') {
    const days = firstDateOrDays;
    return formatDaysString(days);
  }
  
  // Если передана строка, преобразуем ее в дату
  let firstDate;
  if (typeof firstDateOrDays === 'string') {
    firstDate = new Date(firstDateOrDays);
  } else {
    // Если передана дата, используем ее
    firstDate = firstDateOrDays instanceof Date ? firstDateOrDays : new Date();
  }
  
  const now = new Date();
  const diffTime = Math.abs(now - firstDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Количество полных дней
  
  return formatDaysString(diffDays);
}

/**
 * Функция задержки (для ограничения скорости отправки)
 * @param {number} ms - Время задержки в миллисекундах
 * @returns {Promise} - Промис, который разрешается через указанное время
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Функция для отправки сообщений с учетом ограничений Telegram API
const messageQueue = [];
let isProcessingQueue = false;
const MAX_MESSAGES_PER_SECOND = 20; // Макс. сообщений в секунду (лимит Telegram ~30/сек)
const MIN_DELAY_MS = 100; // Минимальная задержка между сообщениями (мс)
let lastMessageTime = 0;
let messageCountInLastSecond = 0;
let lastSecondTimestamp = 0;

/**
 * Отправка сообщения с учетом ограничений скорости Telegram API
 * @param {number} chatId - ID чата для отправки
 * @param {string} text - Текст сообщения
 * @param {Object} options - Опции сообщения
 * @returns {Promise} - Промис результата отправки
 */
function rateLimitedSendMessage(chatId, text, options = {}) {
  return new Promise((resolve, reject) => {
    // Добавляем сообщение в очередь
    messageQueue.push({
      chatId,
      text,
      options,
      resolve,
      reject,
      type: 'text',
      priority: options.priority || 0 // Высший приоритет для срочных сообщений
    });
    
    // Сортируем очередь по приоритету (высокий приоритет вперед)
    messageQueue.sort((a, b) => b.priority - a.priority);
    
    // Запускаем обработку очереди, если она еще не запущена
    if (!isProcessingQueue) {
      processMessageQueue();
    }
  });
}

/**
 * Обработка очереди сообщений с учетом ограничений
 */
async function processMessageQueue() {
  if (isProcessingQueue) return;
  
  isProcessingQueue = true;
  
  while (messageQueue.length > 0) {
    // Проверка лимита сообщений в секунду
    const now = Date.now();
    
    // Если прошла 1 секунда с последней проверки, сбрасываем счетчик
    if (now - lastSecondTimestamp >= 1000) {
      lastSecondTimestamp = now;
      messageCountInLastSecond = 0;
    }
    
    // Если превышен лимит сообщений в секунду, добавляем задержку
    if (messageCountInLastSecond >= MAX_MESSAGES_PER_SECOND) {
      const waitTime = 1000 - (now - lastSecondTimestamp); // Ждем до конца текущей секунды
      if (waitTime > 0) {
        await delay(waitTime);
      }
      // Сбрасываем счетчик и обновляем временную метку
      lastSecondTimestamp = Date.now();
      messageCountInLastSecond = 0;
    }
    
    // Обеспечиваем минимальную задержку между отправками
    const timeSinceLastMessage = now - lastMessageTime;
    if (timeSinceLastMessage < MIN_DELAY_MS) {
      await delay(MIN_DELAY_MS - timeSinceLastMessage);
    }
    
    const message = messageQueue.shift();
    
    try {
      let result;
      
      // Отправляем сообщение в зависимости от типа
      switch (message.type) {
        case 'text':
          result = await bot.telegram.sendMessage(
            message.chatId,
            message.text,
            message.options
          );
          break;
        case 'photo':
          result = await bot.telegram.sendPhoto(
            message.chatId,
            message.fileId,
            message.options
          );
          break;
        case 'video':
          result = await bot.telegram.sendVideo(
            message.chatId,
            message.fileId,
            message.options
          );
          break;
        case 'document':
          result = await bot.telegram.sendDocument(
            message.chatId,
            message.fileId,
            message.options
          );
          break;
        case 'voice':
          result = await bot.telegram.sendVoice(
            message.chatId,
            message.fileId,
            message.options
          );
          break;
        default:
          throw new Error(`Неподдерживаемый тип медиа: ${message.type}`);
      }
      
      // Обновляем счетчики и временные метки
      lastMessageTime = Date.now();
      messageCountInLastSecond++;
      
      message.resolve(result);
    } catch (error) {
      console.error('Ошибка при отправке сообщения из очереди:', error);
      
      // Если ошибка связана с превышением лимита, повторно добавляем сообщение в очередь
      if (error.code === 429 || 
          (error.description && error.description.includes('Too Many Requests'))) {
        console.log('Превышен лимит запросов Telegram API, добавляем задержку...');
        
        // Получаем время ожидания из ответа или используем стандартное значение
        let retryAfter = 1000;
        if (error.parameters && error.parameters.retry_after) {
          retryAfter = error.parameters.retry_after * 1000;
        }
        
        // Добавляем сообщение обратно в очередь с высоким приоритетом
        messageQueue.unshift({
          ...message,
          priority: 10 // Высокий приоритет для повторной отправки
        });
        
        // Ждем указанное время перед продолжением
        await delay(retryAfter);
      } else {
        message.reject(error);
      }
    }
    
    // Добавляем небольшую задержку между сообщениями для предотвращения флуда
    if (messageQueue.length > 0) {
      await delay(MIN_DELAY_MS);
    }
  }
  
  isProcessingQueue = false;
}

// Восстановление активных диалогов при запуске
async function restoreActiveDialogs() {
  try {
    // Получение всех активных диалогов из базы данных
    const activeDialogs = await getAllActiveDialogs();
    console.log(`Найдено ${activeDialogs.length} активных диалогов для восстановления`);
    
    // Если диалогов слишком много, отправляем сообщения с ограничением скорости
    if (activeDialogs.length > 5) {
      console.log(`Обнаружено большое количество диалогов (${activeDialogs.length}), применяется ограничение скорости`);
    }
    
    // Отправляем уведомления с ограниченной скоростью для предотвращения блокировки API
    for (let i = 0; i < activeDialogs.length; i++) {
      const dialog = activeDialogs[i];
      
      try {
        // Получаем информацию об администраторе
        const adminInfo = await getAdminInfo(dialog.admin_id);
        
        // Получаем информацию о пользователе
        const userInfo = await bot.telegram.getChat(dialog.user_id).catch(() => null);
        const userName = userInfo ? getUserDisplayName(userInfo) : `Пользователь ${dialog.user_id}`;
        
        // Уведомление администратора о восстановлении диалога
        if (adminInfo) {
          await rateLimitedSendMessage(
            dialog.admin_id,
            `✅ <b>Восстановлен активный диалог с ${userName}</b>\n\n` +
            'Бот был перезапущен, но ваш диалог с пользователем сохранен. ' +
            'Вы можете продолжить общение или завершить диалог.',
            {
              parse_mode: 'HTML',
              ...adminKeyboard
            }
          );
        }
      } catch (dialogError) {
        console.error(`Ошибка при восстановлении диалога admin_id=${dialog.admin_id}, user_id=${dialog.user_id}:`, dialogError);
      }
      
      // Добавляем задержку для соблюдения лимитов Telegram API
      if (i < activeDialogs.length - 1) {
        await delay(100); // 100 мс между сообщениями
      }
    }
  } catch (error) {
    console.error('Ошибка при восстановлении активных диалогов:', error);
  }
}

// Получение всех активных диалогов
async function getAllActiveDialogs() {
  try {
    return await new Promise((resolve, reject) => {
      db.all(
        `SELECT ad.*, tu.username, tu.first_name, tu.last_name
         FROM admin_dialogs ad
         LEFT JOIN tg_users tu ON ad.user_id = tu.user_id
         WHERE ad.is_active = 1`,
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  } catch (error) {
    console.error('Ошибка при получении активных диалогов:', error);
    return [];
  }
}

// Для отчета о состоянии системы
let lastStatusReportTime = 0;

// Функция отправки ежедневного отчета о статусе системы
async function sendDailyStatusReport() {
  try {
    console.log('Формирование ежедневного отчета о статусе системы...');
    
    // Получаем статистику
    const donorsCount = await db.countAllUsers().catch(() => 'н/д');
    const tgUsersCount = await db.countTelegramUsers().catch(() => 'н/д');
    const messagesCount = await db.getAllMessagesCount().catch(() => 'н/д');
    const unreadCount = await db.getUnreadMessagesCount().catch(() => 'н/д');
    const blockedUsers = await db.getBlockedUsers().catch(() => []);
    
    // Формируем текст отчета
    const reportText = `
📊 *Ежедневный отчет о состоянии системы*

👤 Всего пользователей: ${donorsCount}
👥 Пользователей Telegram: ${tgUsersCount}
💬 Всего сообщений: ${messagesCount}
📩 Непрочитанных сообщений: ${unreadCount}
🚫 Заблокированных пользователей: ${blockedUsers.length}

🕒 Отчет сформирован: ${new Date().toLocaleString('ru-RU')}
    `.trim();
    
    // Отправляем отчет всем администраторам
    const adminIds = getAdminIds();
    for (const adminId of adminIds) {
      try {
        await bot.telegram.sendMessage(adminId, reportText, { parse_mode: 'Markdown' });
        console.log(`Отчет отправлен администратору ${adminId}`);
      } catch (err) {
        console.error(`Не удалось отправить отчет администратору ${adminId}:`, err);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка при формировании ежедневного отчета:', error);
    return false;
  }
}

// Функция для проверки необходимости отправки отчета
function checkAndSendDailyReport() {
  try {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    // Отправляем отчет каждый день в 10:00
    if (hour === 10 && minute >= 0 && minute <= 5) {
      sendDailyStatusReport();
    }
  } catch (error) {
    console.error('Ошибка при проверке времени для отправки отчета:', error);
  }
}

// Экспортируем функцию для использования в index.js
module.exports.sendDailyStatusReport = sendDailyStatusReport;

// Запуск бота
  async function startTgBot() {
    try {
      console.log('Инициализация Telegram-бота...');
      console.log('Токен присутствует:', !!process.env.TELEGRAM_BOT_TOKEN);

      // Запускаем проверку необходимости отправки отчета каждую минуту
      setInterval(checkAndSendDailyReport, 60000);
      
      await bot.launch();
      console.log('Bot.launch() выполнен, бот должен получать апдейты');

      // Регистрируем команды в меню Telegram
      await bot.telegram.setMyCommands([
        { command: 'start', description: 'Перезапустить бота' },
        { command: 'help', description: 'Инструкция по использованию' },
        { command: 'messages', description: 'Показать непрочитанные сообщения (для админов)' },
        { command: 'end', description: 'Завершить текущий диалог (для админов)' },
        { command: 'ping', description: 'Проверка состояния самопинга (для админов)' },
        { command: 'report', description: 'Отправка отчета о состоянии (для админов)' }
      ]);
      
      // Включаем «кнопку меню» Telegram слева от скрепки (Bot API 6.7+)
      try {
        await bot.telegram.setChatMenuButton(undefined, { type: 'commands' });
      } catch (e) {
        console.warn('Не удалось установить chat menu button:', e.message);
      }
      
      // Восстановление состояния активных диалогов при запуске
      try {
        await restoreActiveDialogs();
      } catch (restoreError) {
        console.error('Ошибка при восстановлении активных диалогов:', restoreError);
      }

      console.log('Telegram бот запущен');
      
      // Регистрируем в системе мониторинга
      try {
        const utils = require('./utils');
        if (utils && utils.monitoring && typeof utils.monitoring.updateServiceStatus === 'function') {
          utils.monitoring.updateServiceStatus('telegramBot', true);
        }
      } catch (error) {
        console.log('Статус бота не добавлен в мониторинг:', error.message);
      }
  } catch (error) {
    console.error('Ошибка при запуске Telegram бота:', error);
    // Выводим более подробную информацию об ошибке для отладки
    console.error('Детали ошибки:', error.stack);
  }
}


module.exports = { 
  bot,
  startTgBot,
  kickUserFromGroup,
  notifyAdminToRemoveUser,
  showUnreadMessages,
  showAllMessages,
  startDialog,
  endDialog,
  // Вспомогательные функции
  escapeHtml,
  getUserDisplayName,
  getUserDisplayNameFromMessage,
  // Функции для восстановления состояния
  restoreActiveDialogs,
  getAllActiveDialogs,
  // Заглушки для работы с медиа (оставлены для совместимости)
  notifyAdminsAboutMedia,
  forwardMediaToAdmins,
  // Функции для работы с блокировкой
  blockUserCommand,
  unblockUserCommand,
  showBlockedUsers,

  // Функция для отправки отчетов
  sendDailyStatusReport,
  notifyAdminsAboutNewMessage,
  notifyAdminsAboutMedia,
  checkAndSendDailyReport
}; 

// Обработчик кнопки добавления донора в кэш
bot.action(/^add_donor_(\d+)_(.+)$/, async (ctx) => {
  try {
    const adminId = ctx.from.id;
    if (!isAdmin(adminId)) {
      await ctx.answerCbQuery('У вас нет прав для выполнения этой команды');
      return;
    }
    
    const [, vkId, accessKey] = ctx.match;
    const vkIdNum = Number(vkId);
    
    await ctx.answerCbQuery('Обрабатываю...');
    await ctx.reply(`⏳ Добавляю донора с VK ID ${vkIdNum} в список...`);
    
    // Получаем информацию о пользователе VK
    let vkUserName = null;
    try {
      const vkUser = await require('./utils').getUserInfo(vkIdNum);
      if (vkUser && vkUser.first_name) {
        vkUserName = `${vkUser.first_name} ${vkUser.last_name || ''}`.trim();
        
        // Сохраняем информацию о пользователе VK
        await db.saveVkUser(vkUser);
      }
    } catch (error) {
      console.error('Ошибка при получении информации о VK пользователе:', error);
    }
    
    // Получаем данные о коде
    const keyData = await db.checkAccessKey(accessKey);
    
    // Добавляем в кэш донов
    await db.saveDonorsList([{
      vk_id: vkIdNum,
      vk_name: vkUserName || `ID: ${vkIdNum}`,
      tg_id: keyData?.tg_id || null,
      payment_date: keyData?.payment_date || new Date().toISOString(),
      subscription_days: 30,
      total_amount: 99
    }]);
    
    // Если есть Telegram ID, обновляем информацию
    if (keyData?.tg_id) {
      try {
        const tgUser = await bot.telegram.getChat(keyData.tg_id);
        await saveTelegramUserInfo(tgUser);
        
        const tgName = getUserDisplayName(tgUser);
        await db.updateCachedDonorTgInfo(vkIdNum, keyData.tg_id, tgName);
      } catch (error) {
        console.error('Ошибка при обновлении информации Telegram:', error);
      }
    }
    
    await ctx.reply(
      `✅ Донор успешно добавлен в список!\n\n` +
      `👤 VK: ${vkUserName || `ID: ${vkIdNum}`}\n` +
      `🔑 Код: ${accessKey}`
    );
  } catch (error) {
    console.error('Ошибка при добавлении донора:', error);
    await ctx.reply(`❌ Ошибка при добавлении донора: ${error.message}`);
  }
});

// Обработчик кнопки добавления пользователя в кэш
bot.action(/^add_user_(\d+)_(.+)$/, async (ctx) => {
  try {
    // Проверяем, является ли пользователь администратором
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('⛔ У вас нет доступа к этой команде');
      return;
    }
    
    // Получаем VK ID и код доступа из callback_data
    const vkIdNum = parseInt(ctx.match[1]);
    const accessKey = ctx.match[2];
    
    // Проверяем код в базе данных
    const keyData = await db.checkAccessKey(accessKey);
    if (!keyData || !keyData.exists) {
      await ctx.reply(`❌ Код ${accessKey} не найден в базе данных`);
      return;
    }
    
    await ctx.reply(`⏳ Добавляю пользователя с VK ID ${vkIdNum} в список...`);
    
    // Получаем информацию о пользователе VK
    const vkInfo = await db.getVkUserInfo(vkIdNum).catch(() => null);
    const vkUserName = vkInfo ? `${vkInfo.first_name} ${vkInfo.last_name}` : `ID: ${vkIdNum}`;
    
    // Получаем информацию о пользователе Telegram, если код был использован
    let tgName = null;
    if (keyData.used && keyData.tg_id) {
      const tgInfo = await db.getTelegramUserInfo(keyData.tg_id).catch(() => null);
      tgName = tgInfo ? getUserDisplayName(tgInfo) : `ID: ${keyData.tg_id}`;
    }
    
    // Добавляем пользователя в кэш
    await db.saveUsersList([{
      vk_id: vkIdNum,
      vk_name: vkUserName,
      tg_id: keyData.tg_id || null,
      tg_name: tgName,
      payment_date: keyData.payment_date || new Date().toISOString().split('T')[0],
      subscription_days: 30, // По умолчанию 30 дней
      total_amount: 99 // По умолчанию 99 руб.
    }]);
    
    // Если код был использован, обновляем информацию о Telegram пользователе
    if (keyData.used && keyData.tg_id) {
      await db.updateCachedUserTgInfo(vkIdNum, keyData.tg_id, tgName);
    }
    
    // Отправляем сообщение об успешном добавлении
    await ctx.reply(
      `✅ Пользователь успешно добавлен в список!\n\n` +
      `👤 VK: ${vkUserName}\n` +
      `🔑 Код: ${accessKey}`
    );
  } catch (error) {
    console.error('Ошибка при добавлении пользователя:', error);
    await ctx.reply(`❌ Ошибка при добавлении пользователя: ${error.message}`);
  }
});

/**
 * Функция для генерации и отправки Excel файла со списком доноров
 * @param {Object} ctx - Контекст Telegraf
 */
async function generateAndSendDonorsExcel(ctx) {
  try {
    // Создаем временный путь для сохранения файла
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `donors_list_${Date.now()}.xlsx`);
    
    // Создаем рабочую книгу Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nektar Bot';
    workbook.lastModifiedBy = 'Telegram Bot';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Добавляем лист с донорами
    const worksheet = workbook.addWorksheet('Список донов');
    
    // Определяем заголовки
    worksheet.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Имя пользователя ВК', key: 'vk_name', width: 25 },
      { header: 'ID ВКонтакте', key: 'vk_id', width: 15 },
      { header: 'Ссылка ВК', key: 'vk_link', width: 30 },
      { header: 'ID Telegram', key: 'tg_id', width: 15 },
      { header: 'Имя в Telegram', key: 'tg_name', width: 25 },
      { header: 'Дата первой подписки', key: 'payment_date', width: 17 },
      { header: 'Период подписки', key: 'subscription_days', width: 15 },
      { header: 'Сумма донатов', key: 'amount', width: 15 },
      { header: 'Уникальный ключ', key: 'access_key', width: 20 }
    ];
    
    // Стилизуем заголовок
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Получаем всех доноров из базы данных
    let donorsList = await db.getAllCachedDonors();
    
    // Если список пуст, пробуем получить всех пользователей из таблицы access_keys
    if (!donorsList || donorsList.length === 0) {
      const accessKeys = await db.getAllAccessKeys();
      
      if (accessKeys && accessKeys.length > 0) {
        // Преобразуем доступные ключи в формат списка доноров
        donorsList = accessKeys.map(key => {
          return {
            vk_id: key.vk_id || null,
            vk_name: key.vk_name || null,
            tg_id: key.tg_id || null,
            tg_name: null, // Будет заполнено позже, если есть tg_id
            payment_date: key.payment_date || null,
            subscription_days: key.subscription_days || 30,
            total_amount: key.amount || 99,
            access_key: key.access_key
          };
        });
        
        // Дополняем информацию о пользователях
        for (const donor of donorsList) {
          // Получаем данные о VK пользователе, если есть ID
          if (donor.vk_id && !donor.vk_name) {
            try {
              const vkInfo = await db.getVkUserInfo(donor.vk_id);
              if (vkInfo) {
                donor.vk_name = `${vkInfo.first_name} ${vkInfo.last_name || ''}`.trim();
              }
            } catch (e) {
              console.warn(`Не удалось получить информацию о VK пользователе ${donor.vk_id}:`, e);
            }
          }
          
          // Получаем данные о Telegram пользователе, если есть ID
          if (donor.tg_id && !donor.tg_name) {
            try {
              const tgInfo = await db.getTelegramUserInfo(donor.tg_id);
              if (tgInfo) {
                donor.tg_name = getUserDisplayName(tgInfo);
              }
            } catch (e) {
              console.warn(`Не удалось получить информацию о Telegram пользователе ${donor.tg_id}:`, e);
            }
          }
        }
      }
    }
    
    // Если нет доноров, сообщаем об этом
    if (!donorsList || donorsList.length === 0) {
      await ctx.reply('⚠️ Список донов пуст. Нет данных для экспорта.');
      return;
    }
    
    // Получаем все ключи доступа из базы
    const accessKeys = await db.getAllAccessKeys();
    const keysMap = {};
    
    // Создаем мапу ключей по VK ID
    if (accessKeys && accessKeys.length > 0) {
      accessKeys.forEach(key => {
        if (key.vk_id) {
          if (!keysMap[key.vk_id]) {
            keysMap[key.vk_id] = [];
          }
          keysMap[key.vk_id].push(key.access_key);
        }
      });
    }
    
    // Обрабатываем каждого донора и добавляем строки в Excel
    let rowNumber = 1;
    for (const donor of donorsList) {
      // Пропускаем записи без VK ID
      if (!donor.vk_id) continue;
      
      // Дополнительная проверка и получение информации о VK пользователе, если имя отсутствует
      if (!donor.vk_name || donor.vk_name === '' || donor.vk_name === `ID: ${donor.vk_id}`) {
        try {
          console.log(`Получаем информацию о пользователе VK с ID ${donor.vk_id} для Excel`);
          const vkInfo = await db.getVkUserInfo(donor.vk_id);
          if (vkInfo && (vkInfo.first_name || vkInfo.last_name)) {
            donor.vk_name = `${vkInfo.first_name || ''} ${vkInfo.last_name || ''}`.trim();
            console.log(`Получено имя пользователя VK: ${donor.vk_name}`);
          } else {
            // Если информации нет в базе, пробуем получить из таблицы users
            const userInfo = await db.getUserById(donor.vk_id);
            if (userInfo && userInfo.vk_name) {
              donor.vk_name = userInfo.vk_name;
              console.log(`Получено имя из users: ${donor.vk_name}`);
            }
          }
        } catch (e) {
          console.warn(`Не удалось получить информацию о VK пользователе ${donor.vk_id}:`, e);
        }
      }
      
      // Если имя всё ещё отсутствует, используем заглушку с ID
      if (!donor.vk_name || donor.vk_name === '') {
        donor.vk_name = `ID: ${donor.vk_id}`;
      }
      
      // Определяем ключ доступа
      let accessKey = donor.access_key;
      
      // Если у донора нет ключа, но есть в мапе, берем оттуда
      if (!accessKey && keysMap[donor.vk_id] && keysMap[donor.vk_id].length > 0) {
        accessKey = keysMap[donor.vk_id][0];
      }
      
      // Если ключа всё еще нет, генерируем заглушку
      if (!accessKey) {
        accessKey = 'не задан';
      }
      
      // Форматируем дату подписки
      const paymentDate = donor.payment_date ? 
        new Date(donor.payment_date).toLocaleDateString('ru-RU') : 
        '';
      
      // Рассчитываем количество дней, прошедших с момента первой подписки
      let subscriptionDays = 0;
      if (donor.payment_date) {
        const firstPaymentDate = new Date(donor.payment_date);
        const currentDate = new Date();
        const diffTime = currentDate - firstPaymentDate;
        subscriptionDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Количество полных дней
      }
      
      // Форматируем период подписки с правильным склонением
      const formattedSubscriptionDays = formatDaysString(subscriptionDays);
      
      // Добавляем строку в Excel
      worksheet.addRow({
        no: rowNumber++,
        vk_name: donor.vk_name || '',
        vk_id: donor.vk_id || '',
        vk_link: donor.vk_id ? `https://vk.com/id${donor.vk_id}` : '',
        tg_id: donor.tg_id || '',
        tg_name: donor.tg_name || '',
        payment_date: paymentDate,
        subscription_days: formattedSubscriptionDays,
        amount: donor.amount ? `${donor.amount} руб.` : '99 руб.',
        access_key: accessKey
      });
    }
    
    // Задаем стили для таблицы
    for (let i = 1; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      
      // Центрирование для определенных столбцов
      row.getCell('no').alignment = { horizontal: 'center' };
      row.getCell('vk_id').alignment = { horizontal: 'center' };
      row.getCell('tg_id').alignment = { horizontal: 'center' };
      row.getCell('payment_date').alignment = { horizontal: 'center' };
      row.getCell('subscription_days').alignment = { horizontal: 'center' };
      row.getCell('amount').alignment = { horizontal: 'center' };
      
      // Выравнивание для остальных столбцов
      row.getCell('vk_name').alignment = { horizontal: 'left' };
      row.getCell('vk_link').alignment = { horizontal: 'left' };
      row.getCell('tg_name').alignment = { horizontal: 'left' };
      row.getCell('access_key').alignment = { horizontal: 'center' };
    }
    
    // Сохраняем Excel файл
    await workbook.xlsx.writeFile(filePath);
    
    // Отправляем файл пользователю
    await ctx.replyWithDocument({ source: filePath, filename: 'Список_доноров.xlsx' });
    
    // Удаляем временный файл
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Ошибка при удалении временного файла:', err);
      }
    });
    
  } catch (error) {
    console.error('Ошибка при генерации Excel файла:', error);
    await ctx.reply('❌ Произошла ошибка при создании Excel файла: ' + error.message);
  }
}

        