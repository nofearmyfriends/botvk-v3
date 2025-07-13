const { VK, Keyboard } = require('vk-io');
const db = require('./db');
const utils = require('./utils');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Инициализация ВК бота
const vk = new VK({
  token: process.env.VK_TOKEN || '',
  pollingGroupId: process.env.VK_GROUP_ID || 0,
  apiTimeout: 10000, // 10 секунд таймаут для API запросов
  apiAttempts: 3     // Количество попыток при ошибках запросов
});

// Функция для получения клавиатуры с кнопкой
function getKeyboard() {
  return Keyboard.builder()
    .urlButton({
      label: 'Сочный приват💦',
      url: 'https://vk.com/donut/nekkttar'
    });
}

// Функция для получения расширенной клавиатуры администратора
function getAdminKeyboard() {
  return Keyboard.builder()
    .urlButton({
      label: 'Сочный приват💦',
      url: 'https://vk.com/donut/nekkttar'
    });
}

// Проверка наличия необходимых переменных окружения
if (!process.env.VK_TOKEN || !process.env.VK_GROUP_ID) {
  console.error('Ошибка: Отсутствуют переменные окружения VK_TOKEN или VK_GROUP_ID');
  process.exit(1);
}

// Список администраторов бота
const adminIds = process.env.ADMIN_VK_IDS ? 
  process.env.ADMIN_VK_IDS.split(',').map(id => Number(id.trim())) : 
  [];

// Выводим переменные окружения для отладки
console.log('==== DEBUG INFO ====');
console.log('VK_TOKEN:', process.env.VK_TOKEN ? 'Set (hidden)' : 'Not set');
console.log('VK_GROUP_ID:', process.env.VK_GROUP_ID);
console.log('ADMIN_VK_IDS:', process.env.ADMIN_VK_IDS);
console.log('FORCE_APPROVED_USERS:', process.env.FORCE_APPROVED_USERS);
console.log('===================');

// Функция проверки администратора
function isAdmin(userId) {
  // Проверяем, что userId существует и может быть преобразован в число
  if (userId === undefined || userId === null || isNaN(Number(userId))) {
    return false;
  }
  return adminIds.includes(Number(userId));
}

// Вспомогательная функция для отправки сообщений с клавиатурой
async function sendWithKeyboard(context, message) {
  // Показываем админскую клавиатуру для администраторов
  const keyboard = isAdmin(context.senderId) ? getAdminKeyboard() : getKeyboard();
  return await context.send(message, { keyboard });
}

// Обработка текстовых сообщений
vk.updates.on('message_new', async (context) => {
  // Игнорируем сообщения от сообществ и исходящие сообщения
  if (context.isOutbox || context.senderType !== 'user') return;

  // Проверяем существование текста сообщения перед вызовом toLowerCase()
  const message = context.text ? context.text.toLowerCase().trim() : '';
  console.log(`Получено сообщение от пользователя ${context.senderId}: ${message}`);
  
  // Защита от спама/флуда
  const userId = context.senderId;
  
  // Проверяем, не заблокирован ли пользователь за спам
  if (utils.antiSpam.isBlocked(userId)) {
    const timeLeft = Math.ceil(utils.antiSpam.getTimeToUnblock(userId) / 60000);
    await context.send(`⛔ Слишком много сообщений. Пожалуйста, подождите ${timeLeft} мин.`);
    return;
  }
  
  // Проверка содержимого на спам
  if (message && utils.antiSpam.checkSpamContent(message)) {
    console.warn(`Обнаружен спам-контент от пользователя ${userId}: ${message}`);
    await context.send('❌ Ваше сообщение содержит запрещенный контент.');
    utils.antiSpam.addWarning(userId);
    return;
  }
  
  // Проверка на флуд (частые сообщения)
  if (utils.antiSpam.checkSpam(userId)) {
    // Пользователь уже заблокирован в checkSpam
    const timeLeft = Math.ceil(utils.antiSpam.getTimeToUnblock(userId) / 60000);
    await context.send(`🛑 Вы отправляете сообщения слишком часто. Временная блокировка на ${timeLeft} мин.`);
    return;
  }
  
  // Тестовая команда для проверки конфигурации
  if (message === '/test') {
    const isAdminUser = isAdmin(context.senderId);
    
    // Различные ответы для администраторов и обычных пользователей
    const envInfo = `
    DEBUG INFO:
    VK_TOKEN: ${process.env.VK_TOKEN ? 'Set (Скрыто)' : 'Not set'}
    VK_GROUP_ID: ${process.env.VK_GROUP_ID || 'Not set'}
    ADMIN_VK_IDS: ${isAdminUser ? process.env.ADMIN_VK_IDS || 'Not set' : '[Скрыто]'} 
    FORCE_APPROVED_USERS: ${process.env.FORCE_APPROVED_USERS || 'Not set'}
    
    USER INFO:
    Your ID: ${context.senderId}
    Admin: ${isAdminUser ? 'Yes' : 'No'}
    FORCE_APPROVED: ${utils.checkForceApproved(context.senderId) ? 'Yes' : 'No'}
    `;
    
    await context.send(envInfo);
    return;
  }

  // Команда для администраторов: просмотр ожидающих пользователей
  if (message === '/pending' && isAdmin(context.senderId)) {
    try {
      const pendingUsers = await db.getAllPendingUsers();
      
      if (pendingUsers.length === 0) {
        await context.send('Список ожидающих проверки пуст');
        return;
      }
      
      const pendingList = pendingUsers
        .map(user => {
          const date = new Date(user.last_attempt).toLocaleString('ru');
          return `ID: ${user.vk_id} | Статус: ${user.status} | Попыток: ${user.attempts} | Дата: ${date}`;
        })
        .join('\n');
      
      await context.send(`Список пользователей, ожидающих проверки:\n${pendingList}`);
    } catch (error) {
      console.error('Ошибка при получении списка ожидающих пользователей:', error);
      await context.send('Произошла ошибка при получении списка ожидающих пользователей');
    }
    return;
  }

  // Обработка payload от кнопок
  if (context.messagePayload) {
    const payload = context.messagePayload;
    
    // Здесь можно добавить обработку других команд из payload при необходимости
  }

  // Команда для администраторов: одобрение пользователя
  if (message.startsWith('/approve ') && isAdmin(context.senderId)) {
    try {
      const userId = Number(message.split(' ')[1]);
      if (isNaN(userId)) {
        await context.send('Некорректный ID пользователя');
        return;
      }
      
      await db.approvePendingUser(userId);
      await context.send(`Пользователь с ID ${userId} одобрен`);
    } catch (error) {
      console.error('Ошибка при одобрении пользователя:', error);
      await context.send('Произошла ошибка при одобрении пользователя');
    }
    return;
  }

    if (message === 'оплатил' || message === 'оплатила') {
    console.log(`🔄 Обрабатываем сообщение 'оплатил' от пользователя ${context.senderId}`);
    
    try {
      // Сначала проверяем статус подписки VK Donut
      console.log(`🔍 Этап 1: Проверка VK Donut для пользователя ${context.senderId}...`);
      const hasPayment = await utils.checkVkDonutPayment(context.senderId);
      console.log(`✅ Этап 1 завершен: isDon для ${context.senderId} => ${hasPayment}`);
      
      // Проверяем принудительно одобренных пользователей
      console.log(`🔍 Этап 2: Проверка принудительно одобренных пользователей...`);
      const isForceApproved = context.senderId === 493635171 || utils.checkForceApproved(context.senderId);
      console.log(`✅ Этап 2 завершен: isForceApproved для ${context.senderId} => ${isForceApproved}`);
      
      // Проверяем, есть ли пользователь в списке восстановленных пользователей
      console.log(`🔍 Этап 3: Проверка восстановленных пользователей...`);
      const restoredUsers = await db.getRestoredDonors();
      const isUserInRestoredList = restoredUsers.some(user => user.vk_id === Number(context.senderId));
      console.log(`✅ Этап 3 завершен: isUserInRestoredList для ${context.senderId} => ${isUserInRestoredList}`);
      
      // Проверяем, одобрен ли пользователь в pending_users
      console.log(`🔍 Этап 4: Проверка pending_users...`);
      const isPendingApproved = await db.isPendingApproved(context.senderId);
      console.log(`✅ Этап 4 завершен: isPendingApproved для ${context.senderId} => ${isPendingApproved}`);
      
      // Если пользователь является активным пользователем или принудительно одобрен
      if (hasPayment === true || isForceApproved || isUserInRestoredList || isPendingApproved === true) {
        console.log(`✅ Пользователь ${context.senderId} подтвержден как пользователь`);
        
        // Проверяем, был ли уже выдан ключ
        console.log(`🔍 Этап 5: Проверка существующего ключа...`);
        const existingKey = await db.getUserKey(context.senderId);
        
        if (existingKey) {
          // Для всех пользователей с активной подпиской показываем существующий ключ
          console.log(`Пользователь ${context.senderId} уже имеет ключ: ${existingKey}`);
          await context.send(
            `У вас активная подписка VK Donut!\n` +
            `Ваш код доступа 👉 \"${existingKey}\"\n` +
            `Чтобы активировать код и получить доступ, переходите по ссылке во втором пункте в инструкции, ` +
            `которая находится на стене VK Donut сообщества.`,
            { keyboard: getKeyboard() }
          );
        } else {
          // Генерируем новый ключ для новых или принудительно одобренных пользователей
          const accessKey = await utils.generateUniqueKey();
          
          // Сохраняем информацию в базу данных
          await db.savePayment(context.senderId, accessKey);
          
          // Сохраняем информацию о пользователе
          try {
            const userInfo = await utils.getUserInfo(context.senderId);
            if (userInfo) {
              await db.saveVkUser(userInfo);
              console.log(`Информация о пользователе ${context.senderId} сохранена в базу`);
            }
          } catch (userInfoError) {
            console.warn(`Не удалось сохранить информацию о пользователе ${context.senderId}:`, userInfoError.message);
          }
          
          await context.send(
            `Отлично, Вы Дон сообщества.\n` +
            `Ваш уникальный код доступа 👉 \"${accessKey}\"\n` +
            `Чтобы активировать код и получить доступ, переходите по ссылке во втором пункте в инструкции, ` +
            `которая находится на стене VK Donut сообщества.`,
            { keyboard: getKeyboard() }
          );
        }
      } else {
        // Пользователь не является пользователем
        console.log(`❌ Пользователь ${context.senderId} НЕ подтвержден как пользователь`);
        
        if (hasPayment === undefined || hasPayment === null) {
          await context.send('Не удалось проверить статус подписки. Пожалуйста, попробуйте позже.', 
            { keyboard: getKeyboard() });
          return;
        }
        
        // Проверяем, был ли у пользователя ранее ключ (подписка истекла)
        const oldKey = await db.getUserKey(context.senderId);
        if (oldKey) {
          await context.send(
            'Ваша подписка VK Donut истекла. Пожалуйста, оформите новую подписку через VK Donut.\n\n' +
            'После оформления подписки попробуйте снова через несколько минут.', 
            { keyboard: getKeyboard() }
          );
        } else {
          await context.send(
            'Оплата не найдена. Пожалуйста, убедитесь, что вы оформили подписку через VK Donut.\n\n' +
            'Если вы только что оформили подписку, подождите несколько минут и попробуйте снова.\n\n' +
            'Если проблема сохраняется, обратитесь к администратору.', 
            { keyboard: getKeyboard() }
          );
        }
        
        // Логируем для администратора
        console.log(`Пользователь ${context.senderId} не найден в VK Donut. Добавлен в список ожидающих проверки.`);
      }
    } catch (error) {
      console.error('❌ Ошибка при обработке платежа для пользователя', context.senderId, ':', error);
      console.error('Stack trace:', error.stack);
      
      // Добавляем более детальную информацию об ошибке
      console.error('Детали ошибки:');
      console.error('- Тип ошибки:', error.constructor.name);
      console.error('- Сообщение:', error.message);
      console.error('- Код ошибки:', error.code);
      
      // Определяем тип ошибки для лучшей информации пользователю
      let errorMessage = 'Произошла ошибка при обработке платежа. Пожалуйста, попробуйте позже.';
      
      // Можно добавить более точные сообщения в зависимости от типа ошибки
      if (error.message.includes('database') || error.message.includes('DB') || error.message.includes('sqlite')) {
        errorMessage = 'Ошибка при работе с базой данных. Пожалуйста, попробуйте позже.';
      } else if (error.message.includes('VK API') || error.message.includes('network')) {
        errorMessage = 'Ошибка при обращении к VK. Пожалуйста, попробуйте позже.';
      } else if (error.message.includes('no such function') || error.message.includes('function')) {
        errorMessage = 'Ошибка в функции приложения. Администратор уведомлен.';
      }
      
      await sendWithKeyboard(context, errorMessage);
    }
  }

  // Показ интерактивного меню
  if (message === '/start' || message === 'начать') {
    await context.send('Выберите действие:', {
      keyboard: getKeyboard()
    });
    return;
  }
  

});

// === Событие Donut: создание подписки ===
// (удалён по требованию — бот отвечает только на команду "Оплатил")

// Функция запуска бота
async function startVkBot() {
  try {
    console.log('Запуск VK бота...');
    
    // Запускаем обработку обновлений
    await vk.updates.start();
    console.log('VK бот успешно запущен');
    
    // Регистрируем в системе мониторинга
    try {
      if (utils && utils.monitoring && typeof utils.monitoring.updateServiceStatus === 'function') {
        utils.monitoring.updateServiceStatus('vkBot', true);
      }
    } catch (error) {
      console.log('Статус VK бота не добавлен в мониторинг:', error.message);
    }
  } catch (error) {
    console.error('Ошибка при запуске VK бота:', error);
    
    // Регистрируем ошибку в системе мониторинга
    try {
      if (utils && utils.monitoring && typeof utils.monitoring.updateServiceStatus === 'function') {
        utils.monitoring.updateServiceStatus('vkBot', false, error.message);
      }
    } catch (monitoringError) {
      console.error('Ошибка при обновлении статуса в мониторинге:', monitoringError);
    }
  }
}

// Экспортируем функции и объекты
module.exports = {
  vk,
  isAdmin,
  startVkBot
}; 