const cron = require('node-cron');
const db = require('./db');
const tgBot = require('./tg-bot');
require('dotenv').config();

// Ежедневная проверка активности подписок
async function checkSubscriptions() {
  try {
    console.log('Запуск ежедневной проверки подписок...');
    
    // Деактивация просроченных подписок
    const deactivationResult = await db.deactivateExpiredSubscriptions();
    console.log(`Деактивировано ${deactivationResult.deactivatedCount} подписок`);
    
    // Получение списка пользователей с неактивными подписками
    const inactiveUsers = await db.getInactiveUsers();
    console.log(`Найдено ${inactiveUsers.length} пользователей с неактивными подписками`);
    
    // Попытка удалить пользователей из группы
    const chatId = process.env.TG_CHAT_ID; // ID группы Telegram
    const canRemove = !!chatId && process.env.BOT_CAN_REMOVE === 'true';
    
    if (canRemove) {
      // Удаляем пользователей, если у бота есть права
      const failedToRemove = [];
      
      for (const user of inactiveUsers) {
        const success = await tgBot.kickUserFromGroup(user.tg_id, chatId);
        if (!success) {
          failedToRemove.push(user);
        }
      }
      
      // Уведомляем админа о пользователях, которых не удалось удалить
      if (failedToRemove.length > 0) {
        await tgBot.notifyAdminToRemoveUser(failedToRemove);
      }
    } else {
      // Отправляем список всех неактивных пользователей админу
      await tgBot.notifyAdminToRemoveUser(inactiveUsers);
    }
    
    console.log('Проверка подписок завершена');
  } catch (error) {
    console.error('Ошибка при проверке подписок:', error);
  }
}

// Еженедельная очистка старых сообщений
async function cleanupMessages() {
  try {
    console.log('Запуск еженедельной очистки старых сообщений...');
    
    const result = await db.cleanupOldMessages();
    
    console.log(`Очистка сообщений завершена:`);
    console.log(`- Обработано пользователей: ${result.processedUsers}`);
    console.log(`- Удалено старых сообщений: ${result.totalDeleted}`);
    
    // Уведомляем администраторов об очистке, если она существенная
    if (result.totalDeleted > 0) {
      // Получаем список админов для уведомления
      const adminIds = process.env.ADMIN_TG_IDS ? 
        process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
        [];
      
      if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
        adminIds.push(Number(process.env.ADMIN_TG_ID));
      }
      
      // Отправляем уведомления админам
      for (const adminId of adminIds) {
        try {
          await tgBot.bot.telegram.sendMessage(
            adminId,
            `🧹 <b>Выполнена автоматическая очистка старых сообщений</b>\n\n` +
            `• Обработано пользователей: ${result.processedUsers}\n` +
            `• Удалено сообщений: ${result.totalDeleted}\n\n` +
            `<i>Система оставляет только 5 последних сообщений за последние две недели для каждого пользователя.</i>`,
            { parse_mode: 'HTML' }
          );
        } catch (notifyError) {
          console.error(`Ошибка при отправке уведомления админу ${adminId}:`, notifyError);
        }
      }
    }
  } catch (error) {
    console.error('Ошибка при очистке старых сообщений:', error);
  }
}

// Запуск ежедневной проверки подписок в 00:00
function scheduleDailyCheck() {
  // Запускаем задачу каждый день в полночь (0 0 * * *)
  cron.schedule('0 0 * * *', checkSubscriptions);
  console.log('Запланирована ежедневная проверка подписок');
  
  // Запускаем проверку сразу при старте приложения
  setTimeout(checkSubscriptions, 5000);
}

// Запуск еженедельной очистки сообщений (каждое воскресенье в 03:00)
function scheduleWeeklyCleanup() {
  // 0 3 * * 0 - каждое воскресенье в 3 часа ночи
  cron.schedule('0 3 * * 0', cleanupMessages);
  console.log('Запланирована еженедельная очистка старых сообщений (каждое воскресенье в 03:00)');
}

// Деактивация просроченных подписок (каждые 12 часов)
cron.schedule('0 */12 * * *', async () => {
  console.log('Запуск деактивации просроченных подписок...');
  try {
    const result = await db.deactivateExpiredSubscriptions();
    console.log(`Деактивировано ${result.deactivatedCount} просроченных подписок`);
  } catch (error) {
    console.error('Ошибка при деактивации просроченных подписок:', error);
  }
});

// Очистка старых сообщений (каждые 24 часа в 3 утра)
cron.schedule('0 3 * * *', async () => {
  console.log('Запуск очистки старых сообщений...');
  try {
    const result = await db.cleanupOldMessages();
    console.log(`Очистка сообщений: удалено ${result.totalDeleted} сообщений для ${result.processedUsers} пользователей`);
  } catch (error) {
    console.error('Ошибка при очистке старых сообщений:', error);
  }
});

// Запуск создания резервной копии БД (каждые 3 дня в 2:30 утра)
cron.schedule('30 2 */3 * *', async () => {
  console.log('Запуск создания резервной копии БД...');
  try {
    const backupPath = await db.createBackup();
    console.log(`Резервная копия создана: ${backupPath}`);
    
    // Очистка старых копий
    const deletedCount = await db.cleanupOldBackups(7); // Хранить копии за 7 дней
    console.log(`Удалено ${deletedCount} устаревших резервных копий`);
  } catch (error) {
    console.error('Ошибка при создании резервной копии:', error);
  }
});

// НОВАЯ ЗАДАЧА: Комплексная очистка устаревших данных (каждый понедельник в 4 утра)
cron.schedule('0 4 * * 1', async () => {
  console.log('Запуск комплексной очистки устаревших данных...');
  try {
    const result = await db.cleanupStaleData({
      daysThreshold: 45, // Считать неактивными донов после 45 дней неактивности
      clearInactiveDonors: true
    });
    
    console.log('Результаты очистки устаревших данных:');
    console.log(`- Удалено/деактивировано доноров: ${result.deletedDonors}`);
    console.log(`- Архивировано сообщений: ${result.archivedMessages}`);
    console.log(`- Очищено кэшей: ${result.cleanedCaches}`);
    
    if (result.errors.length > 0) {
      console.warn(`В процессе очистки произошло ${result.errors.length} ошибок:`);
      result.errors.forEach((err, i) => {
        console.warn(`  ${i+1}. ${err.source}: ${err.error}`);
      });
    }
  } catch (error) {
    console.error('Ошибка при комплексной очистке устаревших данных:', error);
  }
});

// НОВАЯ ЗАДАЧА: Очистка сообщений каждый час для самопинга
cron.schedule('0 * * * *', async () => {
  console.log('Запуск ежечасной очистки сообщений (самопинг)...');
  try {
    const result = await db.cleanupOldMessages();
    console.log(`Очистка сообщений: удалено ${result.totalDeleted} сообщений для ${result.processedUsers} пользователей`);
  } catch (error) {
    console.error('Ошибка при очистке старых сообщений:', error);
  }
});

// Включаем расписание бэкапов (раз в 24 часа, хранить 7 дней)
db.scheduleBackups(24, 7);

console.log('Планировщик задач запущен успешно');

// Предотвращаем завершение процесса
process.stdin.resume();

// Обработка завершения процесса
process.on('SIGINT', () => {
  console.log('Планировщик задач останавливается...');
  process.exit(0);
});

module.exports = { 
  scheduleDailyCheck,
  scheduleWeeklyCleanup
}; 