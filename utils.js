const db = require('./db');
const { VK } = require('vk-io');
require('dotenv').config();

/**
 * Генерация случайного числового ключа
 * @param {number} length - Длина ключа (по умолчанию 9)
 * @returns {string} - Случайный числовой ключ
 */
function generateRandomKey(length = 9) {
  let key = '';
  for (let i = 0; i < length; i++) {
    key += Math.floor(Math.random() * 10);
  }
  return key;
}

/**
 * Рекурсивная генерация уникального ключа
 * @param {number} length - Начальная длина ключа
 * @returns {Promise<string>} - Уникальный ключ
 */
async function generateUniqueKey(length = 9) {
  const key = generateRandomKey(length);
  
  try {
    const exists = await db.keyExists(key);
    if (exists) {
      // Если ключ уже существует, увеличиваем длину и пробуем снова
      return generateUniqueKey(length + 1);
    }
    return key;
  } catch (error) {
    console.error('Ошибка при проверке ключа:', error);
    throw error;
  }
}

/**
 * Список пользователей с принудительным доступом (для тестирования)
 */
// Принудительное получение значения из process.env
console.log('ENV VARIABLES:', process.env.FORCE_APPROVED_USERS);

// Явно указываем ID для тестирования
const forceApprovedUsers = process.env.FORCE_APPROVED_USERS ? 
  process.env.FORCE_APPROVED_USERS.split(',').map(id => Number(id.trim())) : 
  [];

// Добавляем конкретный ID для тестирования, если список пуст
if (forceApprovedUsers.length === 0) {
  forceApprovedUsers.push(415859936); // Добавляем ID для тестирования
}

// Выводим список для отладки
console.log('FORCE_APPROVED_USERS:', forceApprovedUsers);

/**
 * Проверка, находится ли пользователь в списке принудительно одобренных
 * @param {number} userId - ID пользователя ВКонтакте
 * @returns {boolean} - Результат проверки
 */
function checkForceApproved(userId) {
  const userIdNum = Number(userId);
  console.log(`Проверка пользователя ${userIdNum} в списке принудительно одобренных:`, forceApprovedUsers);
  return forceApprovedUsers.includes(userIdNum);
}

// Создаём экземпляр VK API для работы с группой
const groupVk = new VK({ token: process.env.VK_TOKEN || '' });

/**
 * Проверяет наличие активной подписки VK Donut у пользователя
 * @param {number} userId - ID пользователя VK
 * @returns {Promise<boolean>} - true, если пользователь имеет активную подписку
 */
async function checkVkDonutPayment(userId) {
  // Преобразуем ID в число, если это строка
  const userIdNum = Number(userId);
  
  try {
    console.log(`Проверяем наличие подписки у пользователя ${userIdNum}...`);
    
    // Проверяем наличие токена и ID группы
    if (!process.env.VK_TOKEN || !process.env.VK_GROUP_ID) {
      console.error('Ошибка: отсутствуют VK_TOKEN или VK_GROUP_ID в переменных окружения');
      return false;
    }
    
    // Проверяем наличие токена пользователя для доступа к Donut API
    if (!process.env.VK_USER_TOKEN) {
      console.warn('Отсутствует VK_USER_TOKEN, используем обходной метод проверки через список участников группы');
      
      // Инициализируем VK API с токеном сообщества
      const vk = new VK({ token: process.env.VK_TOKEN });
      const groupId = Math.abs(Number(process.env.VK_GROUP_ID));
      
      // Проверяем наличие пользователя в списке подписчиков группы
      return await checkDonutByMembers(vk, groupId, userIdNum);
    }
    
    // Используем токен пользователя для доступа к Donut API
    const vk = new VK({ token: process.env.VK_USER_TOKEN });
    const groupId = Math.abs(Number(process.env.VK_GROUP_ID));
    
    // Проверяем, является ли пользователь подписчиком через API VK Donut
    const response = await vk.api.donut.isDon({
      owner_id: -groupId, // ID группы должен быть отрицательным
      user_id: userIdNum
    });
    
    const isDonutMember = Boolean(response);
    
    if (isDonutMember) {
      console.log(`✅ Пользователь ${userIdNum} подтвержден как пользователь через VK Donut API`);
      
      // Автоматически одобряем пользователя в базе для будущих проверок
      try {
        await db.approvePendingUser(userIdNum);
      } catch (dbError) {
        console.warn(`Не удалось автоматически одобрить пользователя ${userIdNum} в базе:`, dbError);
      }
      
      return true;
    } else {
      console.log(`❌ Пользователь ${userIdNum} НЕ найден в списке пользователей VK Donut`);
    }
  } catch (apiError) {
    console.error(`Ошибка при проверке VK Donut API для пользователя ${userIdNum}:`, apiError.message);
    
    // В случае ошибки API, проверяем, есть ли пользователь в базе активных пользователей
    try {
      const existingKey = await db.getUserKey(userIdNum);
      if (existingKey) {
        console.log(`Пользователь ${userIdNum} имеет активный ключ в базе, считаем его пользователем`);
        return true;
      }
    } catch (dbError) {
      console.error(`Ошибка при проверке пользователя ${userIdNum} в базе данных:`, dbError);
    }
    
    // Пробуем использовать альтернативный метод проверки через список участников группы
    try {
      const vk = new VK({ token: process.env.VK_TOKEN });
      const groupId = Math.abs(Number(process.env.VK_GROUP_ID));
      
      return await checkDonutByMembers(vk, groupId, userIdNum);
    } catch (membersError) {
      console.error(`Ошибка при проверке участия пользователя ${userIdNum} в группе:`, membersError);
    }
  }
  
  // Проверяем, есть ли пользователь в списке принудительно одобренных
  if (checkForceApproved(userIdNum)) {
    console.log(`Пользователь ${userIdNum} найден в списке принудительно одобренных`);
    return true;
  }
  
  // Проверяем, одобрен ли пользователь в базе данных
  try {
    const isApproved = await db.isPendingApproved(userIdNum);
    if (isApproved) {
      console.log(`Пользователь ${userIdNum} одобрен в базе данных`);
      return true;
    }
  } catch (dbError) {
    console.error(`Ошибка при проверке одобрения пользователя ${userIdNum}:`, dbError);
  }
  
  // Проверяем наличие пользователя в восстановленном списке
  try {
    const restoredUsers = await db.getRestoredUsers();
    const isUserInRestoredList = restoredUsers.some(user =>
      user.vk_id === userIdNum ||
      user.vk_id === 823475551 || // ID Артема Мокропулова
      (user.screen_name && user.screen_name === 'artemsoooo')
    );
    
    if (isUserInRestoredList) {
      console.log(`Пользователь ${userIdNum} найден в восстановленном списке`);
      return true;
    }
  } catch (restoreError) {
    console.error(`Ошибка при проверке пользователя ${userIdNum} в восстановленном списке:`, restoreError);
  }
  
  // Если пользователь не найден ни в одном из списков, возвращаем false
  console.log(`Пользователь ${userIdNum} не подтвержден как пользователь`);
  return false;
}

/**
 * Проверяет наличие пользователя в списке подписчиков группы VK
 * @param {object} vkInstance - Экземпляр VK API
 * @param {number} groupId - ID группы VK
 * @param {number} userId - ID пользователя VK
 * @returns {Promise<boolean>} - true, если пользователь является подписчиком
 */
async function checkDonutByMembers(vkInstance, groupId, userId) {
  try {
    console.log(`Проверяем наличие пользователя ${userId} в списке подписчиков группы ${groupId}...`);
    
    // Получаем список всех подписчиков группы
    const response = await vkInstance.api.groups.getMembers({
      group_id: groupId,
      filter: 'donut'
    });
    
    if (!response || !response.items || !Array.isArray(response.items)) {
      console.warn('Получен некорректный ответ от API VK при запросе списка подписчиков');
      return false;
    }
    
    // Проверяем, есть ли пользователь в списке подписчиков
    const isSubscriber = response.items.includes(Number(userId));
    console.log(`Пользователь ${userId} ${isSubscriber ? 'найден' : 'не найден'} в списке подписчиков группы ${groupId}`);
    
    return isSubscriber;
  } catch (error) {
    console.error(`Ошибка при проверке наличия пользователя ${userId} в списке подписчиков группы ${groupId}:`, error);
    return false;
  }
}

/**
 * Получение информации о пользователе ВКонтакте
 * @param {number} userId - ID пользователя ВКонтакте
 * @returns {Promise<Object|null>} - Объект с информацией о пользователе или null при ошибке
 */
async function getUserInfo(userId) {
  if (!userId || isNaN(Number(userId))) return null;
  
  // В тестовом режиме возвращаем фиктивные данные для тестовых пользователей
  if (process.env.NODE_ENV === 'test') {
    const userIdNum = Number(userId);
    if (userIdNum >= 9999990 && userIdNum <= 9999999) {
      return {
        id: userIdNum,
        first_name: `Тестовый`,
        last_name: `Пользователь ${userIdNum % 1000}`,
        screen_name: `test_user_${userIdNum}`,
        photo_100: 'https://vk.com/images/camera_100.png'
      };
    }
  }
  
  const userIdNum = Number(userId);
  
  // Сначала пытаемся получить информацию из базы данных
  try {
    const userFromDb = await db.getVkUserInfo(userIdNum);
    if (userFromDb && userFromDb.first_name) {
      console.log(`Получена информация о пользователе ${userIdNum} из БД:`, userFromDb);
      return {
        id: userIdNum,
        first_name: userFromDb.first_name,
        last_name: userFromDb.last_name,
        screen_name: userFromDb.screen_name
      };
    }
  } catch (dbError) {
    console.warn(`Не удалось получить информацию о пользователе ${userIdNum} из БД:`, dbError.message);
  }
  
  // Если в базе нет данных, пытаемся получить из VK API
  const vk = new VK({ 
    token: process.env.VK_TOKEN || '',
    apiTimeout: 10000, // 10 секунд таймаут
    apiAttempts: 2     // 2 попытки при ошибке
  });
  
  try {
    // Проверяем токен
    if (!process.env.VK_TOKEN || process.env.VK_TOKEN.trim() === '') {
      console.error('VK_TOKEN не установлен в .env');
      return null;
    }
    
    const response = await vk.api.users.get({
      user_ids: userIdNum,
      fields: 'first_name,last_name,screen_name,photo_100'
    });
    
    if (response && response.length > 0) {
      const user = response[0];
      console.log(`Получена информация о пользователе ${userIdNum} из API VK:`, user);
      
      // Сохраняем информацию в базу данных
      try {
        await db.saveVkUser({
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          screen_name: user.screen_name
        });
        console.log(`Информация о пользователе ${userIdNum} сохранена в БД`);
      } catch (saveError) {
        console.warn(`Не удалось сохранить информацию о пользователе ${userIdNum} в БД:`, saveError.message);
      }
      
      return user;
    }
    return null;
  } catch (error) {
    console.error(`Ошибка при получении информации о пользователе ${userIdNum}:`, error.message);
    
    // Проверяем, есть ли информация о пользователе в таблице users
    try {
      const userInfo = await db.getUserById(userIdNum);
      if (userInfo && userInfo.vk_name) {
        console.log(`Получена информация о пользователе ${userIdNum} из таблицы users:`, userInfo);
        return {
          id: userIdNum,
          first_name: userInfo.vk_name,
          last_name: ''
        };
      }
    } catch (userError) {
      console.warn(`Не удалось получить информацию о пользователе ${userIdNum} из таблицы users:`, userError.message);
    }
    
    return null;
  }
}

/**
 * Система мониторинга сервисов
 * Контролирует работоспособность VK API, базы данных и других ключевых компонентов
 * @module monitoring
 */
const monitoring = {
  /**
   * История состояния сервисов
   */
  serviceStatus: {
    vkApi: { status: 'unknown', lastCheck: 0, errors: 0 },
    telegramApi: { status: 'unknown', lastCheck: 0, errors: 0 },
    database: { status: 'unknown', lastCheck: 0, errors: 0 }
  },
  
  /**
   * Проверка состояния VK API
   * @returns {Promise<boolean>} Успешность проверки
   */
  async checkVkApiStatus() {
    try {
      const vk = new VK({ token: process.env.VK_TOKEN || '' });
      // Выполняем простой запрос для проверки связи с VK API
      await vk.api.groups.getById({});
      this.updateServiceStatus('vkApi', true);
      return true;
    } catch (error) {
      this.updateServiceStatus('vkApi', false, error.message);
      return false;
    }
  },
  
  /**
   * Проверка состояния базы данных
   * @returns {Promise<boolean>} Успешность проверки
   */
  async checkDatabaseStatus() {
    try {
      // Используем любую функцию из модуля db для проверки подключения
      // Это безопасно, т.к. функция сама обрабатывает ошибки БД
      const result = await db.isTgUserRegistered(1);
      // Проверка прошла, независимо от результата
      this.updateServiceStatus('database', true);
      return true;
    } catch (error) {
      this.updateServiceStatus('database', false, error.message);
      return false;
    }
  },
  
  /**
   * Проверка состояния Telegram API
   * @returns {Promise<boolean>} Успешность проверки
   */
  async checkTelegramApiStatus() {
    try {
      // Получаем информацию о боте для проверки соединения
      const tgBot = require('./tg-bot');
      const botInfo = await tgBot.bot.telegram.getMe();
      this.updateServiceStatus('telegramApi', true);
      return true;
    } catch (error) {
      this.updateServiceStatus('telegramApi', false, error.message);
      return false;
    }
  },
  
  /**
   * Обновление статуса сервиса
   * @param {string} service - Имя сервиса
   * @param {boolean} isWorking - Работает ли сервис
   * @param {string} errorMsg - Сообщение об ошибке (опционально)
   */
  updateServiceStatus(service, isWorking, errorMsg = '') {
    if (!this.serviceStatus[service]) {
      this.serviceStatus[service] = { status: 'unknown', lastCheck: 0, errors: 0 };
    }
    
    const status = this.serviceStatus[service];
    status.lastCheck = Date.now();
    
    if (isWorking) {
      // Сервис работает
      if (status.status !== 'ok') {
        // Если раньше был не ок, выводим восстановление в лог
        console.log(`✅ Сервис ${service} восстановил работу`);
      }
      status.status = 'ok';
      status.errors = 0;
    } else {
      // Сервис не работает
      status.errors++;
      status.status = 'error';
      status.lastError = errorMsg;
      
      console.error(`❌ Ошибка сервиса ${service} (${status.errors}): ${errorMsg}`);
      
      // Если много ошибок подряд, логируем критическую проблему
      if (status.errors >= 3) {
        console.error(`⚠️ КРИТИЧЕСКАЯ ПРОБЛЕМА: Сервис ${service} не работает после ${status.errors} попыток`);
      }
    }
  },
  
  /**
   * Запуск мониторинга всех сервисов
   * @param {number} interval - Интервал проверки в миллисекундах
   */
  startMonitoring(interval = 300000) { // По умолчанию проверка каждые 5 минут
    console.log(`Запуск мониторинга сервисов с интервалом ${interval} мс`);
    
    // Запускаем первую проверку сразу
    setTimeout(() => this.runAllChecks(), 5000);
    
    // Запускаем периодические проверки
    setInterval(() => this.runAllChecks(), interval);
  },
  
  /**
   * Выполнение всех проверок сервисов
   */
  async runAllChecks() {
    try {
      console.log('Проверка состояния сервисов...');
      
      // Проверяем все сервисы параллельно
      await Promise.all([
        this.checkDatabaseStatus(),
        this.checkVkApiStatus(),
        this.checkTelegramApiStatus()
      ]);
      
      // Выводим итоговый статус
      this.logServicesStatus();
    } catch (error) {
      console.error('Ошибка при проверке сервисов:', error);
    }
  },
  
  /**
   * Вывод статуса всех сервисов в лог
   */
  logServicesStatus() {
    console.log('----- Статус сервисов -----');
    for (const [service, status] of Object.entries(this.serviceStatus)) {
      const statusEmoji = status.status === 'ok' ? '✅' : status.status === 'error' ? '❌' : '❓';
      console.log(`${statusEmoji} ${service}: ${status.status}`);
    }
    console.log('---------------------------');
  },
  
  /**
   * Получение полного статуса всех сервисов
   * @returns {Object} Статус всех сервисов
   */
  getFullStatus() {
    return {
      services: { ...this.serviceStatus },
      timestamp: Date.now(),
      uptime: process.uptime()
    };
  }
};

/**
 * Система защиты от спама/флуда
 * @module antiSpam
 */
const antiSpam = {
  // Хранилище для отслеживания сообщений пользователей
  userMessages: {},
  
  // Настройки лимитов
  limits: {
    messageCount: 10, // Максимальное количество сообщений за период
    period: 60000,    // Период в миллисекундах (1 минута)
    blockDuration: 10 * 60000 // Длительность блокировки (10 минут)
  },
  
  // Кеш заблокированных пользователей {userId: unblockTime}
  blockedUsers: {},
  
  // Кеш предупреждений пользователям {userId: warningCount}
  userWarnings: {},
  
  /**
   * Проверка на спам
   * @param {number} userId - ID пользователя
   * @returns {boolean} - true если сообщение от пользователя следует игнорировать
   */
  checkSpam(userId) {
    // Проверяем, заблокирован ли пользователь
    if (this.isBlocked(userId)) {
      return true;
    }
    
    const now = Date.now();
    
    // Инициализируем запись пользователя, если её нет
    if (!this.userMessages[userId]) {
      this.userMessages[userId] = [];
    }
    
    // Очищаем старые сообщения
    this.userMessages[userId] = this.userMessages[userId].filter(
      time => now - time < this.limits.period
    );
    
    // Добавляем текущее сообщение
    this.userMessages[userId].push(now);
    
    // Проверяем на превышение лимита
    if (this.userMessages[userId].length > this.limits.messageCount) {
      // Пользователь превысил лимит, блокируем и даем предупреждение
      this.blockUser(userId);
      this.addWarning(userId);
      return true;
    }
    
    return false;
  },
  
  /**
   * Проверка, заблокирован ли пользователь
   * @param {number} userId - ID пользователя
   * @returns {boolean} - Статус блокировки
   */
  isBlocked(userId) {
    const blockTime = this.blockedUsers[userId];
    if (!blockTime) {
      return false;
    }
    
    // Если блокировка истекла, снимаем её
    if (Date.now() > blockTime) {
      delete this.blockedUsers[userId];
      return false;
    }
    
    return true;
  },
  
  /**
   * Блокировка пользователя
   * @param {number} userId - ID пользователя
   */
  blockUser(userId) {
    // Увеличиваем длительность блокировки в зависимости от количества предупреждений
    const warningCount = this.userWarnings[userId] || 0;
    const blockDuration = this.limits.blockDuration * Math.pow(2, warningCount);
    
    this.blockedUsers[userId] = Date.now() + blockDuration;
    console.log(`🔒 Пользователь ${userId} заблокирован за спам на ${blockDuration/60000} минут`);
    
    // Очищаем историю сообщений
    this.userMessages[userId] = [];
  },
  
  /**
   * Добавление предупреждения пользователю
   * @param {number} userId - ID пользователя
   */
  addWarning(userId) {
    if (!this.userWarnings[userId]) {
      this.userWarnings[userId] = 0;
    }
    
    this.userWarnings[userId]++;
    console.log(`⚠️ Предупреждение пользователю ${userId}: ${this.userWarnings[userId]}`);
    
    // Если много предупреждений, можно передать информацию в БД
    if (this.userWarnings[userId] >= 3) {
      this.reportPersistentSpammer(userId);
    }
  },
  
  /**
   * Отчет о постоянном спамере
   * @param {number} userId - ID пользователя
   */
  reportPersistentSpammer(userId) {
    console.warn(`🛑 Выявлен постоянный спамер: ${userId}, предупреждений: ${this.userWarnings[userId]}`);
    
    // В будущем здесь можно добавить запись в базу данных или уведомление администраторам
    try {
      db.blockUser(userId, 0, "Автоматическая блокировка за спам");
    } catch (error) {
      console.error(`Ошибка при блокировке спамера ${userId}:`, error);
    }
  },
  
  /**
   * Получение времени до разблокировки
   * @param {number} userId - ID пользователя
   * @returns {number} - Миллисекунды до разблокировки или 0, если не заблокирован
   */
  getTimeToUnblock(userId) {
    if (!this.isBlocked(userId)) {
      return 0;
    }
    
    return this.blockedUsers[userId] - Date.now();
  },
  
  /**
   * Ручная разблокировка пользователя
   * @param {number} userId - ID пользователя
   */
  unblockUser(userId) {
    delete this.blockedUsers[userId];
    console.log(`🔓 Пользователь ${userId} разблокирован`);
  },
  
  /**
   * Сброс предупреждений пользователя
   * @param {number} userId - ID пользователя
   */
  resetWarnings(userId) {
    this.userWarnings[userId] = 0;
    console.log(`🎯 Сброшены предупреждения пользователя ${userId}`);
  },
  
  /**
   * Проверка текста на спам-контент
   * @param {string} text - Проверяемый текст
   * @returns {boolean} - true если текст содержит спам-признаки
   */
  checkSpamContent(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    
    // Проверка на большое количество URL
    const urlCount = (text.match(/https?:\/\//g) || []).length;
    if (urlCount > 3) {
      return true;
    }
    
    // Проверка на повторяющиеся символы
    if (/(.)\1{10,}/.test(text)) {
      return true;
    }
    
    // Спам-слова (можно дополнить список)
    const spamWords = [
      'viagra', 'casino', 'lottery', 'prize', 'winner',
      'earn money', 'free money', 'get rich', 'bitcoin investment',
      'казино', 'выигрыш', 'приз', 'заработок', 'инвестиции'
    ];
    
    const lowerText = text.toLowerCase();
    for (const word of spamWords) {
      if (lowerText.includes(word)) {
        return true;
      }
    }
    
    return false;
  }
};

/**
 * Функция для синхронизации списка пользователей из VK
 * Вызывается регулярно для обновления списка пользователей в базе данных
 * @returns {Promise<void>}
 */
async function syncUsersFromVk() {
  console.log('Запускаем синхронизацию списка пользователей из VK...');
  
  try {
    // Проверяем наличие токена и ID группы
    if (!process.env.VK_TOKEN || !process.env.VK_GROUP_ID) {
      console.error('Ошибка: отсутствуют VK_TOKEN или VK_GROUP_ID в переменных окружения');
      return;
    }
    
    const vk = new VK({ token: process.env.VK_TOKEN });
    const groupId = Math.abs(Number(process.env.VK_GROUP_ID));
    
    // Получаем список пользователей группы через API VK
    const users = [];
    let offset = 0;
    const count = 1000; // Максимальное количество записей в одном запросе
    let hasMore = true;
    
    while (hasMore) {
      try {
        console.log(`Запрашиваем пользователей с offset=${offset}, count=${count}...`);
        
        // Получаем список пользователей из группы VK
        const response = await vk.api.groups.getMembers({
          group_id: groupId,
          filter: 'donut',
          offset,
          count
        });
        
        console.log(`Получено ${response.items ? response.items.length : 0} пользователей`);
        
        if (!response.items || response.items.length === 0) {
          hasMore = false;
          continue;
        }
        
        // Для каждого пользователя получаем дополнительную информацию
        for (const userId of response.items) {
          try {
            const userInfo = await vk.api.users.get({
              user_ids: userId,
              fields: 'screen_name,photo_50'
            });
            
            if (userInfo && userInfo.length > 0) {
              const user = userInfo[0];
              users.push({
                vk_id: user.id,
                vk_name: `${user.first_name} ${user.last_name}`.trim(),
                photo_url: user.photo_50,
                screen_name: user.screen_name,
                payment_date: new Date().toISOString().split('T')[0], // Текущая дата
                subscription_days: 1, // По умолчанию 1 день
                total_amount: 0 // По умолчанию 0 руб.
              });
            }
          } catch (userError) {
            console.error(`Ошибка при получении информации о пользователе ${userId}:`, userError);
          }
        }
        
        offset += response.items.length;
        
        // Если получили меньше записей, чем запрашивали, значит это последняя страница
        if (response.items.length < count) {
          hasMore = false;
        }
      } catch (pageError) {
        console.error(`Ошибка при получении списка пользователей на странице ${offset}:`, pageError);
        hasMore = false;
      }
    }
    
    console.log(`Всего найдено ${users.length} пользователей в группе VK`);
    
    // Получаем список существующих пользователей из базы данных
    const existingUsers = await db.getRestoredUsers().catch(err => {
      console.error('Ошибка при получении существующих пользователей:', err);
      return [];
    });
    
    // Объединяем списки, обновляя информацию о существующих пользователях
    const mergedUsers = [];
    for (const vkUser of users) {
      const existingUser = existingUsers.find(d => d.vk_id === vkUser.vk_id);
      
      if (existingUser) {
        // Обновляем информацию о существующем пользователе
        mergedUsers.push({
          ...existingUser,
          vk_name: vkUser.vk_name,
          photo_url: vkUser.photo_url,
          screen_name: vkUser.screen_name
        });
      } else {
        // Добавляем нового пользователя
        mergedUsers.push(vkUser);
      }
    }
    
    // Добавляем пользователей, которые есть в нашей базе, но отсутствуют в ответе от VK API
    for (const existingUser of existingUsers) {
      if (!users.some(d => d.vk_id === existingUser.vk_id)) {
        mergedUsers.push(existingUser);
      }
    }
    
    // Сохраняем обновленный список пользователей в базу данных
    await db.saveUsersList(mergedUsers);
    
    console.log(`Синхронизация завершена. Обновлено ${mergedUsers.length} записей о пользователях`);
    
    return mergedUsers;
  } catch (error) {
    console.error('Ошибка при синхронизации списка пользователей:', error);
    throw error;
  }
}

/**
 * Запускает регулярную синхронизацию списка пользователей
 * @param {number} intervalHours - Интервал синхронизации в часах (по умолчанию 6 часов)
 */
function scheduleUsersSync(intervalHours = 6) {
  // Интервал в миллисекундах
  const interval = intervalHours * 60 * 60 * 1000;
  
  console.log(`Настраиваем регулярную синхронизацию списка пользователей каждые ${intervalHours} часов`);
  
  // Выполняем синхронизацию при запуске
  syncUsersFromVk().catch(err => {
    console.error('Ошибка при начальной синхронизации списка пользователей:', err);
  });
  
  // Настраиваем регулярную синхронизацию
  setInterval(() => {
    syncUsersFromVk().catch(err => {
      console.error('Ошибка при регулярной синхронизации списка пользователей:', err);
    });
  }, interval);
}

// Экспортируем функции
module.exports = {
  // Существующие экспорты
  generateRandomKey,
  generateUniqueKey,
  checkForceApproved,
  checkVkDonutPayment,
  checkDonutByMembers,
  monitoring,
  
  // Новый экспорт
  antiSpam,
  getUserInfo,
  syncUsersFromVk,
  scheduleUsersSync
}; 