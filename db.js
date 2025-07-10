const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Подключение к базе данных
// По умолчанию используем файл БД в корне проекта
const defaultDbDir = __dirname;
if (!process.env.DB_PATH) {
  // Убедимся, что директория существует
  try {
    if (!fs.existsSync(defaultDbDir)) {
      fs.mkdirSync(defaultDbDir, { recursive: true });
    }
  } catch (e) {
    console.error('Не удалось создать директорию для БД:', e);
  }
}

const dbPath = process.env.DB_PATH || path.join(defaultDbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Ошибка при подключении к базе данных:', err.message);
  } else {
    console.log('Успешно подключено к базе данных SQLite');
    // Устанавливаем параметры для оптимальной работы с SQLite
    db.run('PRAGMA journal_mode = WAL', [], function(err) {
      if (err) console.error('Ошибка при установке WAL:', err);
      else console.log('Режим журналирования WAL активирован');
    });
    
    db.run('PRAGMA busy_timeout = 5000', [], function(err) {
      if (err) console.error('Ошибка при установке busy_timeout:', err);
      else console.log('Установлен таймаут ожидания блокировки: 5000 мс');
    });
  }
});

// Функция для обновления структуры таблицы users
async function updateUsersTableStructure() {
  console.log('Проверка и обновление структуры таблицы users...');
  
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(users)`, (err, rows) => {
      if (err) {
        console.error('Ошибка при проверке структуры таблицы users:', err);
        reject(err);
        return;
      }
      
      const columns = Array.isArray(rows) ? rows.map(row => row.name) : [];
      const operations = [];
      
      // Проверяем наличие колонки used
      if (!columns.includes('used')) {
        operations.push(new Promise((resolve, reject) => {
          db.run(`ALTER TABLE users ADD COLUMN used INTEGER DEFAULT 0`, (err) => {
            if (err) {
              console.warn('Ошибка при добавлении колонки used:', err);
              reject(err);
            } else {
              console.log('Добавлена колонка used в таблицу users');
              resolve();
            }
          });
        }));
      }
      
      // Если нет колонки is_active, добавляем её
      if (!columns.includes('is_active')) {
        operations.push(new Promise((resolve, reject) => {
          db.run(`ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1`, (err) => {
            if (err) {
              console.warn('Ошибка при добавлении колонки is_active:', err);
              reject(err);
            } else {
              console.log('Добавлена колонка is_active в таблицу users');
              resolve();
            }
          });
        }));
      }
      
      // Если нет колонки next_payment, добавляем её
      if (!columns.includes('next_payment')) {
        operations.push(new Promise((resolve, reject) => {
          db.run(`ALTER TABLE users ADD COLUMN next_payment TEXT`, (err) => {
            if (err) {
              console.warn('Ошибка при добавлении колонки next_payment:', err);
              reject(err);
            } else {
              console.log('Добавлена колонка next_payment в таблицу users');
              resolve();
            }
          });
        }));
      }
      
      // Если нет колонки total_amount, добавляем её
      if (!columns.includes('total_amount')) {
        operations.push(new Promise((resolve, reject) => {
          db.run(`ALTER TABLE users ADD COLUMN total_amount REAL DEFAULT 0`, (err) => {
            if (err) {
              console.warn('Ошибка при добавлении колонки total_amount:', err);
              reject(err);
            } else {
              console.log('Добавлена колонка total_amount в таблицу users');
              resolve();
            }
          });
        }));
      }
      
      // Выполняем все операции
      if (operations.length > 0) {
        Promise.all(operations)
          .then(() => {
            console.log('Структура таблицы users успешно обновлена');
            resolve();
          })
          .catch((error) => {
            console.error('Ошибка при обновлении структуры таблицы users:', error);
            reject(error);
          });
      } else {
        console.log('Структура таблицы users актуальна, обновление не требуется');
        resolve();
      }
    });
  });
}

// Инициализация базы данных
async function initDatabase() {
  try {
    console.log('Инициализация базы данных...');
    
    // НЕ переоткрываем соединение, так как оно уже создано выше
    // Просто инициализируем схему базы данных
    
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run("PRAGMA journal_mode = WAL", function(err) {
          if (err) console.error('Ошибка при включении WAL:', err.message);
          else console.log("Режим журналирования WAL активирован");
        });

        db.run("PRAGMA busy_timeout = 5000", function(err) {
          if (err) console.error('Ошибка при установке busy_timeout:', err.message);
          else console.log("Установлен таймаут ожидания блокировки: 5000 мс");
        });

        // Таблица для хранения одноразовых ключей и информации о пользователях
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          access_key TEXT UNIQUE,
          vk_id INTEGER,
          tg_id INTEGER,
          payment_date TEXT,
          subscription_days INTEGER,
          used INTEGER DEFAULT 0,
          first_payment_date TEXT,
          total_amount REAL,
          vk_name TEXT
        )`, function(err) {
          if (err) reject(err);
          console.log("Таблица users проверена/создана");
        });

        // Таблица для хранения пользователей TG
        db.run(`CREATE TABLE IF NOT EXISTS tg_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          language_code TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT,
          is_blocked INTEGER DEFAULT 0
        )`, function(err) {
          if (err) reject(err);
          console.log("Таблица tg_users проверена/создана");
        });
        
        // Таблица для хранения пользователей VK
        db.run(`CREATE TABLE IF NOT EXISTS vk_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE,
          first_name TEXT,
          last_name TEXT,
          screen_name TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT
        )`, function(err) {
          if (err) reject(err);
          console.log("Таблица vk_users проверена/создана");
        });

        // Создаем таблицу донатов, если её нет
        db.run(`
          CREATE TABLE IF NOT EXISTS donations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vk_id INTEGER,
            amount INTEGER,
            payment_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('Ошибка при создании таблицы donations:', err);
            reject(err);
            return;
          }
          console.log('Таблица donations проверена/создана');
        });
        
        // Создаем таблицу сообщений пользователей, если её нет
        db.run(`
          CREATE TABLE IF NOT EXISTS user_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER,
            message_text TEXT,
            message_id INTEGER,
            is_read INTEGER DEFAULT 0,
            is_answered INTEGER DEFAULT 0,
            message_type TEXT DEFAULT 'text',
            file_id TEXT,
            from_admin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('Ошибка при создании таблицы user_messages:', err);
            reject(err);
            return;
          }
          console.log('Таблица user_messages проверена/создана');
          
          // Проверяем наличие новых полей в таблице user_messages
          db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
            if (err) {
              console.error('Ошибка при проверке структуры таблицы user_messages:', err);
              return;
            }
            
            // Проверяем наличие поля message_type
            const hasMessageType = Array.isArray(rows) && rows.some(row => row.name === 'message_type');
            if (!hasMessageType) {
              db.run(`ALTER TABLE user_messages ADD COLUMN message_type TEXT DEFAULT 'text'`, (err) => {
                if (err) {
                  console.warn('Ошибка при добавлении поля message_type:', err);
                } else {
                  console.log('Добавлено поле message_type в таблицу user_messages');
                }
              });
            }
            
            // Проверяем наличие поля file_id
            const hasFileId = Array.isArray(rows) && rows.some(row => row.name === 'file_id');
            if (!hasFileId) {
              db.run(`ALTER TABLE user_messages ADD COLUMN file_id TEXT`, (err) => {
                if (err) {
                  console.warn('Ошибка при добавлении поля file_id:', err);
                } else {
                  console.log('Добавлено поле file_id в таблицу user_messages');
                }
              });
            }
            
            // Проверяем наличие поля from_admin
            const hasFromAdmin = Array.isArray(rows) && rows.some(row => row.name === 'from_admin');
            if (!hasFromAdmin) {
              db.run(`ALTER TABLE user_messages ADD COLUMN from_admin INTEGER DEFAULT 0`, (err) => {
                if (err) {
                  console.warn('Ошибка при добавлении поля from_admin:', err);
                } else {
                  console.log('Добавлено поле from_admin в таблицу user_messages');
                }
              });
            }
            
            // Проверяем наличие колонки is_archived
            const hasIsArchived = Array.isArray(rows) && rows.some(row => row.name === 'is_archived');
            
            if (!hasIsArchived) {
              console.log('Добавляем колонку is_archived в таблицу user_messages');
              // Добавляем колонку, если её нет
              db.run("ALTER TABLE user_messages ADD COLUMN is_archived INTEGER DEFAULT 0", (alterErr) => {
                if (alterErr) {
                  console.error('Ошибка при добавлении колонки is_archived:', alterErr);
                } else {
                  console.log('Колонка is_archived успешно добавлена');
                }
              });
            }
          });
        });
        
        // Создаем таблицу диалогов администраторов, если её нет
        db.run(`
          CREATE TABLE IF NOT EXISTS admin_dialogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            user_id INTEGER,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(admin_id, user_id)
          )
        `, (err) => {
          if (err) {
            console.error('Ошибка при создании таблицы admin_dialogs:', err);
            reject(err);
            return;
          }
          console.log('Таблица admin_dialogs проверена/создана');
        });
        
        // Создаем таблицу заблокированных пользователей, если её нет
        db.run(`
          CREATE TABLE IF NOT EXISTS blocked_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE,
            reason TEXT,
            blocked_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('Ошибка при создании таблицы blocked_users:', err);
            reject(err);
            return;
          }
          console.log('Таблица blocked_users проверена/создана');
          resolve(); // Завершаем инициализацию базы данных
        });
      });
    });
    
    // Обновляем структуру таблицы users
    await updateUsersTableStructure();
    
    return db;
  } catch (error) {
    console.error('Ошибка инициализации базы данных:', error);
    throw error;
  }
}

// Сохранение платежа и генерация ключа
async function savePayment(vkId, accessKey) {
  const paymentDate = new Date();
  const nextPayment = new Date();
  nextPayment.setDate(nextPayment.getDate() + 30); // +30 дней

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users (vk_id, access_key, payment_date, next_payment, is_active, key_used)
       VALUES (?, ?, ?, ?, 1, 0)
       ON CONFLICT(vk_id) DO UPDATE SET
         access_key   = excluded.access_key,
         payment_date = excluded.payment_date,
         next_payment = excluded.next_payment,
         is_active    = 1,
         key_used     = 0`,
      [vkId, accessKey, paymentDate.toISOString(), nextPayment.toISOString()],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            vkId,
            accessKey,
            paymentDate,
            nextPayment
          });
        }
      }
    );
  });
}

// Проверка ключа доступа
function checkAccessKey(key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users 
       WHERE access_key = ?`,
      [key],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Проверка ключа доступа с учетом привязки к пользователю
function checkAccessKeyWithUser(key, tgId) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем существует ли такой ключ вообще
    db.get(
      `SELECT * FROM users WHERE access_key = ?`,
      [key],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Если ключа нет, возвращаем null
        if (!row) {
          resolve(null);
          return;
        }
        
        // Проверяем, не использован ли уже ключ
        if (row.used === 0 || row.tg_id === tgId) {
          // Ключ не использован или привязан к текущему пользователю
          resolve(row);
          return;
        }
        
        // Если ключ использован другим пользователем, но пользователь хочет повторно получить доступ
        // Проверяем, есть ли пользователь с таким VK ID в списке восстановленных доноров
        getRestoredDonors().then(donors => {
          // Если пользователь найден среди доноров, это значит что у него активная подписка VK Donut
          const isDonor = donors.some(donor => donor.vk_id === row.vk_id);
          
          if (isDonor) {
            console.log(`VK пользователь ${row.vk_id} найден в списке активных доноров. Разрешаем повторное использование кода ${key} для TG ${tgId}`);
            
            // Обновляем Telegram ID пользователя в базе данных
            db.run(
              `UPDATE users SET tg_id = ? WHERE access_key = ?`,
              [tgId, key],
              function(updateErr) {
                if (updateErr) {
                  console.error(`Ошибка при обновлении tg_id для ключа ${key}:`, updateErr);
                } else {
                  console.log(`Обновлен tg_id пользователя с ключом ${key}: ${tgId}`);
                }
                
                // В любом случае разрешаем доступ
                resolve(row);
              }
            );
          } else {
            // Пользователь не найден среди активных доноров
            console.log(`VK пользователь ${row.vk_id} НЕ найден в списке активных доноров. Код ${key} уже использован.`);
            resolve(null);
          }
        }).catch(error => {
          console.error('Ошибка при проверке донора:', error);
          // В случае ошибки возвращаем null (ключ считается недействительным)
          resolve(null);
        });
      }
    );
  });
}

// Обновление ключа как использованного и добавление Telegram ID
function updateKeyUsed(key, tgId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET used = 1, tg_id = ? WHERE access_key = ?`,
      [tgId, key],
      function(err) {
        if (err) {
          reject(err);
        } else {
          // Получаем информацию о пользователе для обновления кэша
          db.get(`SELECT * FROM users WHERE access_key = ?`, [key], async (err, user) => {
            if (err) {
              console.warn('Не удалось получить информацию о пользователе для кэширования:', err);
              resolve({ changes: this.changes });
              return;
            }
            
            if (user) {
              try {
                // Проверяем существование таблицы cached_donors
                await createCachedDonorsTableIfNotExists();
                
                // Удаляем старую запись, если она есть
                await new Promise((res, rej) => {
                  db.run(`DELETE FROM cached_donors WHERE vk_id = ?`, [user.vk_id], (err) => {
                    if (err) rej(err);
                    else res();
                  });
                });
                
                // Добавляем новую запись в кэш
                await new Promise((res, rej) => {
                  db.run(
                    `INSERT INTO cached_donors (
                      vk_id, vk_name, tg_id, tg_name, payment_date, 
                      subscription_days, total_amount, photo_url, screen_name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      user.vk_id,
                      user.vk_name || null,
                      tgId,
                      null, // tg_name будет обновлено позже
                      user.payment_date || null,
                      user.subscription_days || 0,
                      user.total_amount || 0,
                      null, // photo_url
                      null // screen_name
                    ],
                    function(err) {
                      if (err) rej(err);
                      else res();
                    }
                  );
                });
                
                console.log(`Пользователь ${user.vk_id} с tg_id ${tgId} добавлен в кэш донов`);
              } catch (cacheError) {
                console.error('Ошибка при обновлении кэша донов:', cacheError);
              }
            }
            
            resolve({ changes: this.changes });
          });
        }
      }
    );
  });
}

// Проверка существования ключа
function keyExists(key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT 1 FROM users WHERE access_key = ?`, [key], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(!!row);
      }
    });
  });
}

// Деактивация просроченных подписок
function deactivateExpiredSubscriptions() {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET is_active = 0 
       WHERE next_payment < datetime('now') 
       AND is_active = 1`,
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ deactivatedCount: this.changes });
        }
      }
    );
  });
}

// Получение всех неактивных пользователей
function getInactiveUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM users WHERE is_active = 0 AND tg_id IS NOT NULL`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

/**
 * Проверяет существование таблицы pending_users и создаёт её при отсутствии
 * @returns {Promise<void>}
 */
async function createPendingUsersTableIfNotExists() {
  return new Promise((resolve, reject) => {
    // Проверяем существует ли таблица
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_users'", (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (row) {
        // Таблица уже существует
        resolve();
        return;
      }
      
      // Создаем таблицу
      const sql = `
        CREATE TABLE pending_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vk_id INTEGER NOT NULL,
          is_approved INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      db.run(sql, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log('Таблица pending_users успешно создана');
        resolve();
      });
    });
  });
}

/**
 * Добавление пользователя VK в список ожидающих проверки
 * @param {number} vkId - ID пользователя ВКонтакте
 * @returns {Promise<boolean>} - Результат операции
 */
async function addPendingUser(vkId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы и создаем при необходимости
      await createPendingUsersTableIfNotExists();
      
      // Проверяем существует ли уже запись
      db.get('SELECT * FROM pending_users WHERE vk_id = ?', [vkId], (err, row) => {
        if (err) {
          console.error('Ошибка при проверке pending_user:', err);
          reject(err);
          return;
        }
        
        if (row) {
          // Пользователь уже есть в списке, обновляем время
          db.run('UPDATE pending_users SET updated_at = CURRENT_TIMESTAMP WHERE vk_id = ?', [vkId], (err) => {
            if (err) {
              console.error('Ошибка при обновлении pending_user:', err);
              reject(err);
            } else {
              resolve(true);
            }
          });
        } else {
          // Добавляем нового пользователя
          db.run('INSERT INTO pending_users (vk_id) VALUES (?)', [vkId], (err) => {
            if (err) {
              console.error('Ошибка при добавлении pending_user:', err);
              reject(err);
            } else {
              resolve(true);
            }
          });
        }
      });
    } catch (error) {
      console.error('Ошибка при добавлении пользователя в pending_users:', error);
      reject(error);
    }
  });
}

/**
 * Проверяет одобрен ли пользователь в списке ожидающих проверки
 * @param {number} vkId - ID пользователя ВКонтакте
 * @returns {Promise<boolean>} - Статус проверки
 */
async function isPendingApproved(vkId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы и создаем при необходимости
      await createPendingUsersTableIfNotExists();
      
      // Проверяем статус пользователя
      db.get('SELECT is_approved FROM pending_users WHERE vk_id = ?', [vkId], (err, row) => {
        if (err) {
          console.error('Ошибка при проверке статуса pending_user:', err);
          reject(err);
          return;
        }
        
        if (!row) {
          // Пользователя нет в списке
          resolve(false);
        } else {
          // Пользователь найден, проверяем статус is_approved
          resolve(row.is_approved === 1);
        }
      });
    } catch (error) {
      console.error('Ошибка при проверке статуса в pending_users:', error);
      reject(error);
    }
  });
}

/**
 * Одобрение пользователя в списке ожидающих проверки
 * @param {number} vkId - ID пользователя ВКонтакте
 * @returns {Promise<boolean>} - Результат операции
 */
async function approvePendingUser(vkId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы и создаем при необходимости
      await createPendingUsersTableIfNotExists();
      
      // Проверяем существует ли уже запись
      db.get('SELECT * FROM pending_users WHERE vk_id = ?', [vkId], (err, row) => {
        if (err) {
          console.error('Ошибка при проверке pending_user:', err);
          reject(err);
          return;
        }
        
        if (row) {
          // Пользователь уже есть в списке, обновляем статус и время
          db.run('UPDATE pending_users SET is_approved = 1, updated_at = CURRENT_TIMESTAMP WHERE vk_id = ?', [vkId], (err) => {
            if (err) {
              console.error('Ошибка при одобрении пользователя:', err);
              reject(err);
            } else {
              console.log(`Пользователь ${vkId} одобрен в списке ожидающих проверки`);
              resolve(true);
            }
          });
        } else {
          // Добавляем нового пользователя с одобренным статусом
          db.run('INSERT INTO pending_users (vk_id, is_approved) VALUES (?, 1)', [vkId], (err) => {
            if (err) {
              console.error('Ошибка при добавлении одобренного пользователя:', err);
              reject(err);
            } else {
              console.log(`Пользователь ${vkId} добавлен в список ожидающих проверки со статусом "одобрен"`);
              resolve(true);
            }
          });
        }
      });
    } catch (error) {
      console.error('Ошибка при одобрении пользователя:', error);
      reject(error);
    }
  });
}

/**
 * Получение всех ожидающих проверки пользователей
 * @returns {Promise<Array>} - Список пользователей
 */
async function getAllPendingUsers() {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы и создаем при необходимости
      await createPendingUsersTableIfNotExists();
      
      // Получаем список пользователей
      db.all('SELECT * FROM pending_users', (err, rows) => {
        if (err) {
          console.error('Ошибка при получении списка pending_users:', err);
          reject(err);
          return;
        }
        
        resolve(rows || []);
      });
    } catch (error) {
      console.error('Ошибка при получении списка pending_users:', error);
      reject(error);
    }
  });
}

// Проверка существования ключа доступа у пользователя и получение этого ключа
function getUserKey(vkId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT access_key FROM users WHERE vk_id = ? AND is_active = 1`,
      [vkId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.access_key : null);
        }
      }
    );
  });
}

// Получение ключа доступа и VK ID по Telegram ID
function getUserKeyByTgId(tgId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT access_key, vk_id FROM users WHERE tg_id = ? AND is_active = 1`,
      [tgId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

// Проверка, зарегистрирован ли Telegram-пользователь (уже использовал код)
function isTgUserRegistered(tgId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM users WHERE tg_id = ? AND used = 1`,
      [tgId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

// Добавление тестового пользователя с кодом доступа
function addTestUser(vkId, accessKey) {
  const paymentDate = new Date();

  return new Promise((resolve, reject) => {
    // Сначала проверяем, существует ли пользователь с таким vk_id
    db.get('SELECT * FROM users WHERE vk_id = ?', [vkId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (row) {
        // Обновляем существующего пользователя
        db.run(
          `UPDATE users SET 
           access_key = ?, 
           payment_date = ?, 
           used = 0 
           WHERE vk_id = ?`,
          [accessKey, paymentDate.toISOString(), vkId],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve({
                vkId,
                accessKey,
                paymentDate,
                updated: true
              });
            }
          }
        );
      } else {
        // Добавляем нового пользователя
        db.run(
          `INSERT INTO users (vk_id, access_key, payment_date, used)
           VALUES (?, ?, ?, 0)`,
          [vkId, accessKey, paymentDate.toISOString()],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve({
                vkId,
                accessKey,
                paymentDate,
                updated: false
              });
            }
          }
        );
      }
    });
  });
}

// Получение списка всех донов с информацией о платежах
function getAllDonors() {
  return new Promise((resolve, reject) => {
    console.log('Запрашиваем список всех донатеров...');
    
    // Флаг для указания, нужно ли сбросить кэш
    const forceRefresh = true;
    
    // Проверяем кэшированные данные только если не указан сброс кэша
    if (!forceRefresh) {
      getCachedDonors().then(cachedDonors => {
        if (cachedDonors && cachedDonors.length > 0) {
          console.log(`Найдено ${cachedDonors.length} донов в кэше`);
          resolve(cachedDonors);
          return;
        }
        
        // Если в кэше нет данных, продолжаем запрос из таблиц
        fetchDonorsFromDatabase(resolve, reject);
      }).catch(error => {
        console.error('Ошибка при получении кэшированных донов:', error);
        fetchDonorsFromDatabase(resolve, reject);
      });
    } else {
      // Если нужно сбросить кэш, сразу запрашиваем из таблиц
      console.log('Запрашиваем свежие данные из базы, минуя кэш...');
      fetchDonorsFromDatabase(resolve, reject);
    }
  });
}

// Вспомогательная функция для запроса данных из таблиц
function fetchDonorsFromDatabase(resolve, reject) {
  // Запрос из таблицы donations
  const query = `
    SELECT 
      d.vk_id,
      u.tg_id,
      v.first_name || ' ' || v.last_name as vk_name,
      d.payment_date as first_payment_date,
      COALESCE(u.total_amount, 0) as total_amount,
      GROUP_CONCAT(d.payment_date) as payment_dates,
      SUM(d.amount) as donation_amount
    FROM donations d
    LEFT JOIN users u ON d.vk_id = u.vk_id
    LEFT JOIN vk_users v ON d.vk_id = v.user_id
    GROUP BY d.vk_id
    ORDER BY SUM(d.amount) DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Ошибка при получении всех донатов:', err);
      
      // Используем восстановленный список, если таблица не существует или пуста
      console.log('Используем восстановленный список из скриншота...');
      getRestoredDonors().then(resolve).catch(reject);
    } else {
      // Если в выборке нет записей, попробуем получить данные только из таблицы users
      if (!rows || rows.length === 0) {
        console.log('В таблице donations нет записей, пытаемся получить данные из users...');
        
        // Проверяем наличие данных в таблице users и vk_users
        db.all(`
          SELECT 
            u.vk_id,
            u.tg_id,
            v.first_name || ' ' || v.last_name as vk_name,
            u.payment_date as first_payment_date,
            u.payment_date,
            u.subscription_days,
            COALESCE(u.total_amount, 0) as total_amount
          FROM users u
          LEFT JOIN vk_users v ON u.vk_id = v.user_id
          WHERE (u.subscription_days > 0 OR u.tg_id IS NOT NULL)
          ORDER BY u.payment_date DESC
        `, [], async (err, userRows) => {
          if (err || !userRows || userRows.length === 0) {
            console.log('В таблице users нет данных о донатах, используем восстановленный список...');
            getRestoredDonors().then(donors => {
              // Сохраняем восстановленный список в кэш
              saveDonorsList(donors).finally(() => {
                resolve(donors);
              });
            }).catch(reject);
          } else {
            console.log(`Найдено ${userRows.length} донатов из таблицы users`);
            
            // Сохраняем данные в кэш
            saveDonorsList(userRows).finally(() => {
              resolve(userRows);
            });
          }
        });
      } else {
        console.log(`Найдено ${rows.length} донатов из таблицы donations`);
        
        // Сохраняем данные в кэш
        saveDonorsList(rows).finally(() => {
          resolve(rows);
        });
      }
    }
  });
}

// Функция для получения данных донатеров из таблицы users
function getUsersAsDonors() {
  return new Promise((resolve, reject) => {
    console.log('Получаем данные донатеров из таблицы users...');
    
    db.all(`
      SELECT 
        user_id as vk_id,
        tg_id,
        first_name || ' ' || last_name as vk_name,
        first_payment_date,
        payment_date,
        subscription_days,
        total_amount
      FROM users
      WHERE (total_amount > 0 OR subscription_days > 0)
      ORDER BY total_amount DESC, payment_date DESC
    `, [], async (err, userRows) => {
      if (err) {
        console.error('Ошибка при получении донатов из таблицы users:', err);
        resolve([]); // Возвращаем пустой массив в случае ошибки
      } else if (!userRows || userRows.length === 0) {
        console.log('В таблице users нет данных о донатах, пытаемся получить данные из VK...');
        
        try {
          // Здесь можно было бы добавить логику получения данных из VK API
          // Но поскольку нам нужно использовать существующие данные, возвращаем пустой массив
          resolve([]);
        } catch (e) {
          console.error('Ошибка при получении данных из VK:', e);
          resolve([]);
        }
      } else {
        console.log(`Найдено ${userRows.length} донатов из таблицы users`);
        
        // Восстанавливаем данные из скриншота пользователя (хардкод из-за отсутствия реальных данных)
        // Это временное решение, которое следует заменить на реальные данные из базы
        const knownDonors = [
          {vk_id: 89839635, vk_name: 'Semen Razhev', tg_id: 1038962117, tg_name: '@karpik666', payment_date: '2025-06-25', subscription_days: 3, total_amount: 0},
          {vk_id: 796773581, vk_name: 'Николай Чудотворец', tg_id: 1875075644, tg_name: '@Sergey', payment_date: '2025-06-25', subscription_days: 3, total_amount: 0},
          {vk_id: 10354155, vk_name: 'Илья Шпанагель', tg_id: 331959137, tg_name: '@Hozushka', payment_date: '2025-06-24', subscription_days: 4, total_amount: 0},
          {vk_id: 848376829, vk_name: 'The Hoksi', tg_id: null, tg_name: '@Hoksi', payment_date: '2025-06-23', subscription_days: 5, total_amount: 0},
          {vk_id: 786310481, vk_name: 'Михаил Ремизов', tg_id: 7469221612, tg_name: '@Mikhail', payment_date: '2025-06-23', subscription_days: 5, total_amount: 0},
          {vk_id: 352948178, vk_name: 'Максим Шпильков', tg_id: 1861557183, tg_name: '@Maksim_Shpilkov', payment_date: '2025-06-23', subscription_days: 5, total_amount: 0},
          {vk_id: 8091285, vk_name: 'Василий Дубовкин', tg_id: 5216616497, tg_name: '@Atlas_woodwork', payment_date: '2025-06-23', subscription_days: 5, total_amount: 0},
          {vk_id: 133508888, vk_name: 'Артём Пестерников', tg_id: 1632161859, tg_name: '@Artem_Pesternikov', payment_date: '2025-06-22', subscription_days: 6, total_amount: 0},
          {vk_id: 493635171, vk_name: 'Андрей Королёв', tg_id: 1203713024, tg_name: '@Andrey_Korolev', payment_date: '2025-06-20', subscription_days: 8, total_amount: 0},
          {vk_id: 222962312, vk_name: 'Максим Рябов', tg_id: 5088102074, tg_name: '@thesizek69', payment_date: '2025-06-14', subscription_days: 14, total_amount: 0},
          {vk_id: 321001635, vk_name: 'Анастасия Николаева', tg_id: 886004731, tg_name: '@anasteisess', payment_date: '2025-06-14', subscription_days: 14, total_amount: 0},
          {vk_id: 329766483, vk_name: 'No Name', tg_id: 540041681, tg_name: '@ozzz152', payment_date: '2025-06-14', subscription_days: 14, total_amount: 0},
          {vk_id: 415859936, vk_name: 'Миша Алмазов', tg_id: 6795839726, tg_name: '@Misha_Almazov', payment_date: '2025-06-14', subscription_days: 14, total_amount: 0}
        ];
        
        // Проверяем совпадения между известными донатерами и данными из таблицы users
        const mergedDonors = knownDonors.map(knownDonor => {
          const matchingUser = userRows.find(u => u.vk_id === knownDonor.vk_id || u.tg_id === knownDonor.tg_id);
          if (matchingUser) {
            return {
              ...knownDonor,
              total_amount: matchingUser.total_amount || knownDonor.total_amount,
              first_payment_date: matchingUser.first_payment_date || knownDonor.payment_date
            };
          }
          return knownDonor;
        });
        
        console.log(`Сформирован список из ${mergedDonors.length} донатеров`);
        resolve(mergedDonors);
      }
    });
  });
}

// Подсчет всех донатеров в системе
function countAllDonors() {
  return new Promise((resolve, reject) => {
    // Сначала проверяем существование таблицы
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='donations'", (tableErr, tableResult) => {
      if (tableErr) {
        console.error('Ошибка при проверке таблицы donations:', tableErr);
        resolve(0);
        return;
      }
      
      if (!tableResult) {
        console.log('Таблица donations не существует');
        resolve(0);
        return;
      }
      
      // Если таблица существует, считаем донатеров
      db.get("SELECT COUNT(DISTINCT vk_id) as count FROM donations", (err, row) => {
        if (err) {
          console.error('Ошибка при подсчете донатеров:', err);
          resolve(0);
        } else {
          resolve(row ? row.count : 0);
        }
      });
    });
  });
}

// Подсчет всех пользователей Telegram
function countTelegramUsers() {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM telegram_users", (err, row) => {
      if (err) {
        console.error('Ошибка при подсчете пользователей Telegram:', err);
        reject(err);
      } else {
        resolve(row ? row.count : 0);
      }
    });
  });
}

// Сохранение информации о пользователе Telegram
function saveTelegramUser(user) {
  return new Promise((resolve, reject) => {
    if (!user || !user.id) {
      reject(new Error('Не указан ID пользователя Telegram'));
      return;
    }
    
    const now = new Date().toISOString();
    
    // Проверяем существование пользователя
    db.get('SELECT user_id FROM tg_users WHERE user_id = ?', [user.id], (err, row) => {
      if (err) {
        console.error('Ошибка при проверке пользователя Telegram:', err);
        reject(err);
        return;
      }
      
      if (row) {
        // Обновляем существующего пользователя
        db.run(`
          UPDATE tg_users 
          SET username = ?, first_name = ?, last_name = ?, language_code = ?, updated_at = ?
          WHERE user_id = ?
        `, [
          user.username || null,
          user.first_name || null,
          user.last_name || null,
          user.language_code || null,
          user.updated_at || now,
          user.id
        ], (err) => {
          if (err) {
            console.error(`Ошибка при обновлении пользователя Telegram ${user.id}:`, err);
            reject(err);
          } else {
            console.log(`Пользователь Telegram ${user.id} обновлен`);
            resolve();
          }
        });
      } else {
        // Добавляем нового пользователя
        db.run(`
          INSERT INTO tg_users (user_id, username, first_name, last_name, language_code, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          user.id,
          user.username || null,
          user.first_name || null,
          user.last_name || null,
          user.language_code || null,
          user.updated_at || now
        ], (err) => {
          if (err) {
            console.error(`Ошибка при добавлении пользователя Telegram ${user.id}:`, err);
            reject(err);
          } else {
            console.log(`Пользователь Telegram ${user.id} добавлен`);
            resolve();
          }
        });
      }
    });
  });
}

/**
 * Сохранение сообщения пользователя в базе данных
 * @param {Object} messageData - Данные сообщения
 * @param {number} messageData.tg_id - ID пользователя Telegram
 * @param {string} messageData.message_text - Текст сообщения
 * @param {number} messageData.message_id - ID сообщения в Telegram
 * @param {string} messageData.message_type - Тип сообщения ('text', 'photo', 'video', 'document', etc.)
 * @param {string} messageData.file_id - ID файла в Telegram (для мультимедийных сообщений)
 * @returns {Promise<Object>} - Результат операции
 */
function saveUserMessage(messageData) {
  return new Promise((resolve, reject) => {
    if (!messageData || !messageData.tg_id) {
      reject(new Error('Неполные данные сообщения'));
      return;
    }
    
    const messageType = messageData.message_type || 'text';
    const fromAdmin = messageData.from_admin || 0;
    
    db.run(
      `INSERT INTO user_messages (tg_id, message_text, message_id, message_type, file_id, from_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        messageData.tg_id, 
        messageData.message_text || '', 
        messageData.message_id || null,
        messageType,
        messageData.file_id || null,
        fromAdmin
      ],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            tg_id: messageData.tg_id,
            message_text: messageData.message_text || '',
            message_id: messageData.message_id,
            message_type: messageType,
            file_id: messageData.file_id || null
          });
        }
      }
    );
  });
}

/**
 * Получение списка непрочитанных сообщений
 * @param {number} limit - Максимальное количество сообщений
 * @returns {Promise<Array>} - Массив сообщений
 */
function getUnreadMessages(limit = 50) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.all(
          `SELECT um.*, tu.username, tu.first_name, tu.last_name
           FROM user_messages um
           LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
           WHERE um.is_read = 0
           ORDER BY um.created_at DESC
           LIMIT ?`,
          [limit],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE um.is_read = 0
         AND (um.is_archived IS NULL OR um.is_archived = 0)
         ORDER BY um.created_at DESC
         LIMIT ?` :
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE um.is_read = 0
         ORDER BY um.created_at DESC
         LIMIT ?`;
      
      // Выполняем запрос
      db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  });
}

/**
 * Получение последних сообщений от пользователей
 * @param {number} limit - Максимальное количество сообщений
 * @returns {Promise<Array>} - Массив сообщений
 */
function getLatestUserMessages(limit = 50) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.all(
          `SELECT um.*, tu.username, tu.first_name, tu.last_name
           FROM user_messages um
           LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
           ORDER BY um.created_at DESC
           LIMIT ?`,
          [limit],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE (um.is_archived IS NULL OR um.is_archived = 0)
         ORDER BY um.created_at DESC
         LIMIT ?` :
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         ORDER BY um.created_at DESC
         LIMIT ?`;
      
      // Выполняем запрос
      db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  });
}

/**
 * Получение истории сообщений конкретного пользователя
 * @param {number} tgId - ID пользователя Telegram
 * @param {number} limit - Максимальное количество сообщений
 * @returns {Promise<Array>} - Массив сообщений
 */
function getUserMessageHistory(tgId, limit = 50) {
  return new Promise((resolve, reject) => {
    // Получаем список админов
    const adminIds = process.env.ADMIN_TG_IDS ? 
      process.env.ADMIN_TG_IDS.split(',').map(id => Number(id.trim())) : 
      [];
      
    // Если также задан ADMIN_TG_ID, добавляем его в список
    if (process.env.ADMIN_TG_ID && !adminIds.includes(Number(process.env.ADMIN_TG_ID))) {
      adminIds.push(Number(process.env.ADMIN_TG_ID));
    }
    
    // Проверяем, является ли запрашиваемый пользователь админом
    const isAdmin = adminIds.includes(tgId);
    
    // Если запрашивается история админа, возвращаем только сообщения от пользователей
    // Если запрашивается история обычного пользователя, возвращаем только его сообщения
    db.all(
      `SELECT * FROM user_messages 
       WHERE tg_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [tgId, limit],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

/**
 * Отметить сообщение как прочитанное
 * @param {number} messageId - ID сообщения
 * @returns {Promise<Object>} - Результат операции
 */
function markMessageAsRead(messageId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE user_messages SET is_read = 1 WHERE id = ?`,
      [messageId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ messageId, changes: this.changes });
        }
      }
    );
  });
}

/**
 * Отметить все сообщения пользователя как прочитанные
 * @param {number} tgId - ID пользователя Telegram
 * @returns {Promise<Object>} - Результат операции
 */
function markAllUserMessagesAsRead(tgId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE user_messages SET is_read = 1 WHERE tg_id = ? AND is_read = 0`,
      [tgId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ tgId, changes: this.changes });
        }
      }
    );
  });
}

// Функция для выполнения последовательности операций с базой данных
function runSequentially(operations) {
  return new Promise((resolve, reject) => {
    const results = [];
    let index = 0;
    
    function runNext() {
      if (index >= operations.length) {
        resolve(results);
        return;
      }
      
      const operation = operations[index];
      
      operation()
        .then(result => {
          results.push(result);
          index++;
          runNext();
        })
        .catch(err => {
          reject(err);
        });
    }
    
    runNext();
  });
}

// Функция для безопасного выполнения транзакции
function runTransaction(operations) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        runSequentially(operations)
          .then(results => {
            db.run('COMMIT', (err) => {
              if (err) {
                // Пытаемся откатить транзакцию в случае ошибки
                db.run('ROLLBACK', () => {
                  reject(err);
                });
                return;
              }
              resolve(results);
            });
          })
          .catch(err => {
            // Откатываем транзакцию при ошибке
            db.run('ROLLBACK', () => {
              reject(err);
            });
          });
      });
    });
  });
}

/**
 * Очистка старых сообщений, оставляет только 5 последних сообщений за две недели
 * для каждого пользователя
 * @returns {Promise<Object>} - Информация об удаленных сообщениях
 */
function cleanupOldMessages() {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14); // Две недели назад
  const twoWeeksAgoStr = twoWeeksAgo.toISOString();
  
  return new Promise((resolve, reject) => {
    // Шаг 1: Получаем список всех пользователей с сообщениями
    db.all(
      `SELECT DISTINCT tg_id FROM user_messages`,
      [],
      (err, users) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (users.length === 0) {
          resolve({ totalDeleted: 0, processedUsers: 0 });
          return;
        }
        
        // Создаем последовательность операций для каждого пользователя
        const operations = [];
        
        for (const user of users) {
          operations.push(() => new Promise((resolveUser, rejectUser) => {
            // Получаем ID всех сообщений, кроме 5 последних за две недели
            db.all(
              `SELECT id FROM user_messages 
               WHERE tg_id = ? AND created_at < ?
               AND id NOT IN (
                 SELECT id FROM user_messages
                 WHERE tg_id = ? AND created_at < ?
                 ORDER BY created_at DESC
                 LIMIT 5
               )`,
              [user.tg_id, twoWeeksAgoStr, user.tg_id, twoWeeksAgoStr],
              (err, messagesToDelete) => {
                if (err) {
                  rejectUser(err);
                  return;
                }
                
                if (messagesToDelete.length === 0) {
                  resolveUser({
                    tg_id: user.tg_id,
                    deleted: 0
                  });
                  return;
                }
                
                // Создаем параметризованный запрос для удаления
                const placeholders = messagesToDelete.map(() => '?').join(',');
                const idsToDelete = messagesToDelete.map(msg => msg.id);
                
                // Удаляем сообщения через параметризованный запрос
                db.run(
                  `DELETE FROM user_messages WHERE id IN (${placeholders})`,
                  idsToDelete,
                  function(err) {
                    if (err) {
                      rejectUser(err);
                      return;
                    }
                    
                    resolveUser({
                      tg_id: user.tg_id,
                      deleted: this.changes
                    });
                  }
                );
              }
            );
          }));
        }
        
        // Выполняем операции последовательно
        runSequentially(operations)
          .then(userResults => {
            // Считаем общее количество удаленных сообщений
            let totalDeleted = 0;
            for (const result of userResults) {
              totalDeleted += result.deleted;
              if (result.deleted > 0) {
                console.log(`Удалено ${result.deleted} старых сообщений для пользователя ${result.tg_id}`);
              }
            }
            
            resolve({
              totalDeleted,
              processedUsers: users.length
            });
          })
          .catch(error => {
            console.error('Ошибка при очистке сообщений:', error);
            reject(error);
          });
      }
    );
  });
}

/**
 * Проверка, заблокирован ли пользователь
 * @param {number} tgId - ID пользователя Telegram
 * @returns {Promise<boolean>} - true если пользователь заблокирован
 */
function isUserBlocked(tgId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM blocked_users WHERE tg_id = ?`,
      [tgId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

/**
 * Блокировка пользователя
 * @param {number} tgId - ID пользователя Telegram для блокировки
 * @param {number} adminId - ID администратора, выполняющего блокировку
 * @param {string} reason - Причина блокировки
 * @returns {Promise<Object>} - Результат операции
 */
function blockUser(tgId, adminId, reason = '') {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO blocked_users (tg_id, blocked_by, reason, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [tgId, adminId, reason],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            tg_id: tgId,
            blocked_by: adminId,
            reason
          });
        }
      }
    );
  });
}

/**
 * Разблокировка пользователя
 * @param {number} tgId - ID пользователя Telegram для разблокировки
 * @returns {Promise<Object>} - Результат операции
 */
function unblockUser(tgId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM blocked_users WHERE tg_id = ?`,
      [tgId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ 
            tg_id: tgId,
            changes: this.changes
          });
        }
      }
    );
  });
}

/**
 * Получение списка заблокированных пользователей
 * @returns {Promise<Array>} - Список заблокированных пользователей
 */
function getBlockedUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT bu.*, tu.username, tu.first_name, tu.last_name,
              admin.username as admin_username, admin.first_name as admin_first_name, 
              admin.last_name as admin_last_name
       FROM blocked_users bu
       LEFT JOIN tg_users tu ON bu.tg_id = tu.user_id
       LEFT JOIN tg_users admin ON bu.blocked_by = admin.user_id
       ORDER BY bu.created_at DESC`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Создание диалога между администратором и пользователем
 * @param {number} adminId - ID администратора
 * @param {number} userId - ID пользователя
 * @returns {Promise<Object>} - Результат операции
 */
function createAdminDialog(adminId, userId) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем, существует ли уже активный диалог с этим пользователем у другого админа
    db.get(
      `SELECT * FROM admin_dialogs WHERE user_id = ? AND is_active = 1`,
      [userId],
      (err, existingDialog) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Если диалог существует и он не принадлежит текущему администратору
        if (existingDialog && existingDialog.admin_id !== adminId) {
          // Получаем информацию о другом администраторе
          db.get(
            `SELECT username, first_name, last_name FROM tg_users WHERE user_id = ?`,
            [existingDialog.admin_id],
            (err, adminInfo) => {
              if (err) {
                reject(err);
                return;
              }
              
              // Формируем имя администратора
              const otherAdminName = adminInfo ? 
                (adminInfo.username ? `@${adminInfo.username}` : 
                  `${adminInfo.first_name || ''} ${adminInfo.last_name || ''}`.trim()) :
                `Администратор ${existingDialog.admin_id}`;
              
              resolve({
                error: 'DIALOG_EXISTS',
                message: `У пользователя уже есть активный диалог с администратором ${otherAdminName}.`,
                otherAdminId: existingDialog.admin_id
              });
            }
          );
          return;
        }
        
        // Создаем или обновляем запись диалога
        const now = new Date().toISOString();
        db.run(
          `INSERT OR REPLACE INTO admin_dialogs (admin_id, user_id, is_active, created_at, updated_at)
           VALUES (?, ?, 1, COALESCE((SELECT created_at FROM admin_dialogs WHERE admin_id = ? AND user_id = ?), ?), ?)`,
          [adminId, userId, adminId, userId, now, now],
          function(err) {
            if (err) {
              reject(err);
              return;
            }
            
            // Помечаем все сообщения пользователя как прочитанные
            db.run(
              `UPDATE user_messages SET is_read = 1 WHERE tg_id = ?`,
              [userId],
              function(updateErr) {
                if (updateErr) {
                  console.error('Ошибка при обновлении статуса сообщений:', updateErr);
                }
                
                resolve({
                  success: true,
                  admin_id: adminId,
                  user_id: userId,
                  created_at: now,
                  updated_at: now,
                  is_active: 1
                });
              }
            );
          }
        );
      }
    );
  });
}

/**
 * Завершение диалога между администратором и пользователем
 * @param {number} adminId - ID администратора Telegram
 * @param {number} userId - ID пользователя Telegram
 * @returns {Promise<Object>} - Результат операции
 */
function closeAdminDialog(adminId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE admin_dialogs 
       SET is_active = 0, updated_at = datetime('now') 
       WHERE admin_id = ? AND user_id = ? AND is_active = 1`,
      [adminId, userId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ adminId, userId, changes: this.changes });
        }
      }
    );
  });
}

/**
 * Проверка наличия активного диалога между администратором и пользователем
 * @param {number} adminId - ID администратора Telegram
 * @param {number} userId - ID пользователя Telegram
 * @returns {Promise<boolean>} - Результат проверки
 */
function hasActiveDialog(adminId, userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM admin_dialogs 
       WHERE admin_id = ? AND user_id = ? AND is_active = 1`,
      [adminId, userId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

/**
 * Получение активного диалога администратора
 * @param {number} adminId - ID администратора Telegram
 * @returns {Promise<Object|null>} - Данные диалога или null
 */
function getAdminActiveDialog(adminId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ad.*, tu.username, tu.first_name, tu.last_name
       FROM admin_dialogs ad
       LEFT JOIN tg_users tu ON ad.user_id = tu.user_id
       WHERE ad.admin_id = ? AND ad.is_active = 1`,
      [adminId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Получение списка пользователей, с которыми последний раз общался администратор
 * @param {number} adminId - ID администратора Telegram
 * @param {number} limit - Максимальное количество пользователей
 * @returns {Promise<Array>} - Список пользователей
 */
function getAdminRecentUsers(adminId, limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ad.*, tu.username, tu.first_name, tu.last_name
       FROM admin_dialogs ad
       LEFT JOIN tg_users tu ON ad.user_id = tu.user_id
       WHERE ad.admin_id = ?
       ORDER BY ad.updated_at DESC
       LIMIT ?`,
      [adminId, limit],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

/**
 * Получение общего количества непрочитанных сообщений
 * @returns {Promise<number>} - Общее количество непрочитанных сообщений
 */
function getUnreadMessagesCount() {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.get(
          `SELECT COUNT(*) as count 
           FROM user_messages 
           WHERE is_read = 0`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row ? row.count : 0);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT COUNT(*) as count 
         FROM user_messages 
         WHERE is_read = 0
         AND (is_archived IS NULL OR is_archived = 0)` :
        `SELECT COUNT(*) as count 
         FROM user_messages 
         WHERE is_read = 0`;
      
      // Выполняем запрос
      db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.count : 0);
        }
      });
    });
  });
}

/**
 * Получение непрочитанных сообщений с пагинацией
 * @param {number} offset - Смещение для пагинации
 * @param {number} limit - Количество сообщений на страницу
 * @returns {Promise<Array>} - Массив сообщений
 */
function getUnreadMessagesWithPagination(offset = 0, limit = 10) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.all(
          `SELECT um.*, tu.username, tu.first_name, tu.last_name
           FROM user_messages um
           LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
           WHERE um.is_read = 0 
           ORDER BY um.created_at DESC
           LIMIT ? OFFSET ?`,
          [limit, offset],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE um.is_read = 0 
         AND (um.is_archived IS NULL OR um.is_archived = 0)
         ORDER BY um.created_at DESC
         LIMIT ? OFFSET ?` :
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE um.is_read = 0 
         ORDER BY um.created_at DESC
         LIMIT ? OFFSET ?`;
      
      // Выполняем запрос
      db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  });
}

/**
 * Получение общего количества всех сообщений
 * @returns {Promise<number>} - Общее количество всех сообщений
 */
function getAllMessagesCount() {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.get(
          `SELECT COUNT(*) as count 
           FROM user_messages`,
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row ? row.count : 0);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT COUNT(*) as count 
         FROM user_messages
         WHERE (is_archived IS NULL OR is_archived = 0)` :
        `SELECT COUNT(*) as count 
         FROM user_messages`;
      
      // Выполняем запрос
      db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.count : 0);
        }
      });
    });
  });
}

/**
 * Получение всех сообщений с пагинацией
 * @param {number} offset - Смещение для пагинации
 * @param {number} limit - Количество сообщений на страницу
 * @returns {Promise<Array>} - Массив сообщений
 */
function getAllMessagesWithPagination(offset = 0, limit = 10) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем наличие колонки is_archived
    db.all(`PRAGMA table_info(user_messages)`, (err, rows) => {
      if (err) {
        console.warn('Ошибка при проверке структуры таблицы:', err);
        // В случае ошибки используем запрос без проверки is_archived
        db.all(
          `SELECT um.*, tu.username, tu.first_name, tu.last_name
           FROM user_messages um
           LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
           ORDER BY um.created_at DESC
           LIMIT ? OFFSET ?`,
          [limit, offset],
          (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows || []);
            }
          }
        );
        return;
      }
      
      // Проверяем наличие колонки is_archived
      const hasIsArchived = rows.some(row => row.name === 'is_archived');
      
      // Формируем SQL запрос в зависимости от наличия колонки
      const sql = hasIsArchived ?
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         WHERE (um.is_archived IS NULL OR um.is_archived = 0)
         ORDER BY um.created_at DESC
         LIMIT ? OFFSET ?` :
        `SELECT um.*, tu.username, tu.first_name, tu.last_name
         FROM user_messages um
         LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
         ORDER BY um.created_at DESC
         LIMIT ? OFFSET ?`;
      
      // Выполняем запрос
      db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  });
}

/**
 * Получение одного сообщения по его ID
 * @param {number} messageId - ID сообщения
 * @returns {Promise<Object|null>} - Данные сообщения или null
 */
function getUserMessageById(messageId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT um.*, tu.username, tu.first_name, tu.last_name
       FROM user_messages um
       LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
       WHERE um.id = ?`,
      [messageId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Получение всех активных диалогов администраторов с конкретным пользователем
 * @param {number} userId - ID пользователя Telegram
 * @returns {Promise<Array>} - Список активных диалогов
 */
function getAllAdminDialogsWithUser(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM admin_dialogs 
       WHERE user_id = ? AND is_active = 1`,
      [userId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Проверяет наличие активного диалога между админом и пользователем
 * @param {number} adminId - ID администратора
 * @param {number} userId - ID пользователя
 * @returns {Promise<Object|null>} - Объект диалога или null
 */
function getAdminDialogBetween(adminId, userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM admin_dialogs 
       WHERE admin_id = ? AND user_id = ?`,
      [adminId, userId],
      (err, row) => {
        if (err) {
          console.error(`Ошибка при проверке диалога между админом ${adminId} и пользователем ${userId}:`, err);
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Создание резервной копии базы данных
 * @returns {Promise<string>} Путь к созданному файлу резервной копии
 */
function createBackup() {
  return new Promise((resolve, reject) => {
    // Формируем имя файла с датой и временем
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupDir = path.join(__dirname, 'backups');
    const backupFile = path.join(backupDir, `backup_${dateStr}.db`);
    
    // Создаем директорию для резервных копий, если её нет
    if (!fs.existsSync(backupDir)) {
      try {
        fs.mkdirSync(backupDir, { recursive: true });
      } catch (err) {
        console.error('Ошибка при создании директории для резервных копий:', err);
        reject(err);
        return;
      }
    }
    
    console.log(`Создание резервной копии базы данных: ${backupFile}`);
    
    // Сохраняем текущее подключение и создаем новое для бэкапа
    const backupDb = new sqlite3.Database(backupFile, (err) => {
      if (err) {
        console.error('Ошибка при создании файла резервной копии:', err);
        reject(err);
        return;
      }
      
      // Бэкап с использованием sqlite3 backup API
      db.serialize(() => {
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
          if (err) {
            console.error('Ошибка при получении списка таблиц:', err);
            reject(err);
            return;
          }
          
          // Начинаем транзакцию для бэкапа
          backupDb.serialize(() => {
            // Для каждой таблицы копируем данные
            const tablePromises = tables.map(table => {
              return new Promise((resolveTable, rejectTable) => {
                if (table.name === 'sqlite_sequence') return resolveTable(); // Пропускаем системную таблицу
                
                db.all(`SELECT sql FROM sqlite_master WHERE name='${table.name}'`, (err, createStmts) => {
                  if (err) {
                    rejectTable(err);
                    return;
                  }
                  
                  if (createStmts.length === 0) {
                    rejectTable(new Error(`Не найден SQL для создания таблицы ${table.name}`));
                    return;
                  }
                  
                  // Создаем таблицу в бэкапе
                  backupDb.run(createStmts[0].sql, function(err) {
                    if (err) {
                      rejectTable(err);
                      return;
                    }
                    
                    // Получаем все данные из таблицы
                    db.all(`SELECT * FROM ${table.name}`, (err, rows) => {
                      if (err) {
                        rejectTable(err);
                        return;
                      }
                      
                      if (rows.length === 0) {
                        // Таблица пуста
                        resolveTable();
                        return;
                      }
                      
                      // Вставляем данные в бэкап-таблицу
                      const columns = Object.keys(rows[0]).join(',');
                      const placeholders = Object.keys(rows[0]).map(() => '?').join(',');
                      
                      const insertStmt = backupDb.prepare(`INSERT INTO ${table.name} (${columns}) VALUES (${placeholders})`);
                      
                      // Вставляем строки
                      const insertPromises = rows.map(row => {
                        return new Promise((resolveInsert, rejectInsert) => {
                          const values = Object.values(row);
                          insertStmt.run(values, function(err) {
                            if (err) rejectInsert(err);
                            else resolveInsert();
                          });
                        });
                      });
                      
                      Promise.all(insertPromises)
                        .then(() => {
                          insertStmt.finalize();
                          resolveTable();
                        })
                        .catch(err => rejectTable(err));
                    });
                  });
                });
              });
            });
            
            Promise.all(tablePromises)
              .then(() => {
                backupDb.close((err) => {
                  if (err) {
                    console.error('Ошибка при закрытии файла резервной копии:', err);
                    reject(err);
                  } else {
                    console.log(`Резервная копия базы данных успешно создана: ${backupFile}`);
                    resolve(backupFile);
                  }
                });
              })
              .catch(err => {
                console.error('Ошибка при создании резервной копии:', err);
                reject(err);
              });
          });
        });
      });
    });
  });
}

/**
 * Очистка старых резервных копий
 * @param {number} keepDays - Количество дней, за которые хранить копии
 * @returns {Promise<number>} Количество удаленных файлов
 */
function cleanupOldBackups(keepDays = 7) {
  return new Promise((resolve, reject) => {
    const backupDir = path.join(__dirname, 'backups');
    
    // Проверяем существование директории
    if (!fs.existsSync(backupDir)) {
      resolve(0);
      return;
    }
    
    // Получаем все файлы в директории
    fs.readdir(backupDir, (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Фильтруем только .db файлы
      const backupFiles = files.filter(file => file.endsWith('.db'));
      
      // Получаем информацию о файлах
      const now = Date.now();
      const keepTime = keepDays * 24 * 60 * 60 * 1000; // дни в миллисекунды
      
      // Проверяем каждый файл
      let deletedCount = 0;
      const deletePromises = backupFiles.map(file => {
        return new Promise((resolveDelete) => {
          const filePath = path.join(backupDir, file);
          
          fs.stat(filePath, (err, stats) => {
            if (err) {
              console.error(`Ошибка при получении информации о файле ${file}:`, err);
              resolveDelete();
              return;
            }
            
            // Проверяем возраст файла
            const fileAge = now - stats.mtime.getTime();
            if (fileAge > keepTime) {
              // Файл старше указанного периода, удаляем
              fs.unlink(filePath, (err) => {
                if (err) {
                  console.error(`Ошибка при удалении старого бэкапа ${file}:`, err);
                } else {
                  console.log(`Удален старый бэкап: ${file}`);
                  deletedCount++;
                }
                resolveDelete();
              });
            } else {
              resolveDelete();
            }
          });
        });
      });
      
      Promise.all(deletePromises)
        .then(() => resolve(deletedCount))
        .catch(err => reject(err));
    });
  });
}

/**
 * Запуск плановых резервных копирований
 * @param {number} intervalHours - Интервал между копированиями в часах
 * @param {number} keepDays - Сколько дней хранить копии
 */
function scheduleBackups(intervalHours = 24, keepDays = 7) {
  console.log(`Настройка регулярного резервного копирования БД: интервал ${intervalHours}ч, хранение ${keepDays} дней`);
  
  // Запускаем первое копирование через 5 минут после старта
  setTimeout(() => {
    console.log('Запуск первоначального резервного копирования...');
    createBackup()
      .then(() => cleanupOldBackups(keepDays))
      .catch(err => console.error('Ошибка при первоначальном резервном копировании:', err));
  }, 5 * 60 * 1000);
  
  // Настраиваем регулярное копирование
  setInterval(() => {
    console.log('Запуск планового резервного копирования...');
    createBackup()
      .then(() => cleanupOldBackups(keepDays))
      .catch(err => console.error('Ошибка при плановом резервном копировании:', err));
  }, intervalHours * 60 * 60 * 1000);
}

// Получение информации о пользователе Telegram из БД
async function getTelegramUserInfo(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM tg_users WHERE user_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          console.error('Ошибка при получении данных пользователя Telegram:', err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Получение информации о пользователе ВКонтакте из БД
async function getVkUserInfo(vkId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM vk_users WHERE user_id = ?',
      [vkId],
      (err, row) => {
        if (err) {
          console.error('Ошибка при получении данных пользователя ВКонтакте:', err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// Функция сохранения информации о пользователе VK
async function saveVkUser(userData) {
  return new Promise((resolve, reject) => {
    if (!userData || !userData.id) {
      console.warn('Попытка сохранить пустого пользователя VK');
      return resolve(false);
    }
    
    const now = new Date().toISOString();
    
    // Проверяем существует ли пользователь
    db.get('SELECT * FROM vk_users WHERE user_id = ?', [userData.id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (row) {
        // Обновляем существующего пользователя
        db.run(
          `UPDATE vk_users SET 
          first_name = ?, 
          last_name = ?, 
          screen_name = ?, 
          updated_at = ?
          WHERE user_id = ?`,
          [
            userData.first_name || row.first_name,
            userData.last_name || row.last_name,
            userData.screen_name || row.screen_name,
            now,
            userData.id
          ],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.changes > 0);
            }
          }
        );
      } else {
        // Добавляем нового пользователя
        db.run(
          `INSERT INTO vk_users (user_id, first_name, last_name, screen_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [userData.id, userData.first_name, userData.last_name, userData.screen_name, now, now],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.lastID);
            }
          }
        );
      }
    });
  });
}

// Получение информации о пользователе ВК из таблицы users
async function getUserById(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE vk_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          console.error('Ошибка при получении данных пользователя из таблицы users:', err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

/**
 * Архивирует сообщения (вместо удаления), устанавливая флаг is_archived = 1
 * @param {Object} params - Параметры архивации
 * @param {Date|null} params.beforeDate - Дата, до которой архивировать сообщения (null - не учитывать)
 * @param {boolean} params.onlyRead - Архивировать только прочитанные
 * @param {number|null} params.userId - ID пользователя (null - все пользователи)
 * @returns {Promise<Object>} - Результат операции с количеством архивированных сообщений
 */
function archiveMessages(params = {}) {
  return new Promise((resolve, reject) => {
    // Строим условия SQL запроса на основе параметров
    const conditions = [];
    const queryParams = [];
    
    // Проверяем наличие колонки is_archived, добавляем если нет
    db.get("PRAGMA table_info(user_messages)", (err, columns) => {
      if (err) {
        console.error('Ошибка при проверке структуры таблицы:', err);
        reject(err);
        return;
      }
      
      db.all("PRAGMA table_info(user_messages)", (err, rows) => {
        if (err) {
          console.error('Ошибка при проверке структуры таблицы:', err);
          reject(err);
          return;
        }
        
        // Проверяем наличие колонки is_archived
        const hasArchiveColumn = rows.some(row => row.name === 'is_archived');
        
        if (!hasArchiveColumn) {
          console.log('Добавляем колонку is_archived в таблицу user_messages');
          // Добавляем колонку, если её нет
          db.run("ALTER TABLE user_messages ADD COLUMN is_archived INTEGER DEFAULT 0", (alterErr) => {
            if (alterErr) {
              console.error('Ошибка при добавлении колонки is_archived:', alterErr);
              reject(alterErr);
              return;
            }
            
            console.log('Колонка is_archived успешно добавлена');
            // После добавления колонки продолжаем архивацию
            performArchive();
          });
        } else {
          // Колонка уже существует, продолжаем архивацию
          performArchive();
        }
      });
    });
    
    // Функция для выполнения архивации
    function performArchive() {
      // Строим условия SQL запроса
      if (params.beforeDate) {
        const dateStr = params.beforeDate.toISOString();
        conditions.push("created_at < ?");
        queryParams.push(dateStr);
      }
      
      if (params.onlyRead) {
        conditions.push("is_read = 1");
      }
      
      if (params.userId) {
        conditions.push("tg_id = ?");
        queryParams.push(params.userId);
      }
      
      // Добавляем условие, чтобы архивировать только неархивированные сообщения
      conditions.push("(is_archived IS NULL OR is_archived = 0)");
      
      // Формируем SQL запрос
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const sql = `UPDATE user_messages SET is_archived = 1 ${whereClause}`;
      
      // Выполняем запрос
      db.run(sql, queryParams, function(err) {
        if (err) {
          console.error('Ошибка при архивации сообщений:', err);
          reject(err);
        } else {
          resolve({
            count: this.changes,
            success: true
          });
        }
      });
    }
  });
}



/**
 * Получает список пользователей, имеющих сообщения
 * @returns {Promise<Array>} - Массив пользователей
 */
function getUsersWithMessages() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT um.tg_id, tu.username, tu.first_name, tu.last_name,
              COUNT(um.id) as message_count
       FROM user_messages um
       LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
       GROUP BY um.tg_id
       ORDER BY tu.username, tu.first_name`,
      [],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Получает статистику по сообщениям
 * @returns {Promise<Object>} - Объект со статистикой
 */
function getMessagesStatistics() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT
         COUNT(*) as total_count,
         SUM(CASE WHEN is_read = 1 THEN 1 ELSE 0 END) as read_count,
         SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread_count,
         SUM(CASE WHEN from_admin = 1 THEN 1 ELSE 0 END) as admin_count,
         SUM(CASE WHEN from_admin = 0 THEN 1 ELSE 0 END) as user_count,
         MIN(created_at) as oldest_message,
         MAX(created_at) as newest_message,
         COUNT(DISTINCT tg_id) as unique_users
       FROM user_messages`,
      [],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || {
            total_count: 0,
            read_count: 0,
            unread_count: 0,
            admin_count: 0,
            user_count: 0,
            oldest_message: null,
            newest_message: null,
            unique_users: 0
          });
        }
      }
    );
  });
}

// Функция для получения восстановленного списка донов
function getRestoredDonors() {
  return new Promise((resolve, reject) => {
    console.log('Восстанавливаем список донатеров из базы данных...');
    
    // Запрашиваем данные из таблиц users и vk_users
    const query = `
      SELECT 
        u.vk_id,
        u.tg_id,
        v.first_name || ' ' || v.last_name as vk_name,
        u.payment_date,
        30 as subscription_days,
        COALESCE(u.total_amount, 0) as total_amount,
        tg.first_name || ' ' || COALESCE(tg.last_name, '') as tg_name,
        '@' || COALESCE(tg.username, 'unknown_user') as tg_username,
        u.access_key
      FROM users u
      LEFT JOIN vk_users v ON u.vk_id = v.user_id
      LEFT JOIN tg_users tg ON u.tg_id = tg.user_id
      WHERE u.vk_id IS NOT NULL
    `;
    
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Ошибка при получении донатеров из базы:', err);
        
        // Если в базе нет данных, возвращаем пустой массив
        console.log('Не удалось получить донатеров из базы, возвращаем пустой список');
        resolve([]);
        return;
      }
      
      // Если запрос вернул данные, форматируем их
      if (rows && rows.length > 0) {
        console.log(`Найдено ${rows.length} записей в базе данных`);
        
        // Форматируем данные
        const donors = rows.map(row => {
          return {
            vk_id: row.vk_id,
            vk_name: row.vk_name || `ID: ${row.vk_id}`,
            tg_id: row.tg_id,
            tg_name: row.tg_username || row.tg_name || null,
            payment_date: row.payment_date,
            first_payment_date: row.payment_date,
            subscription_days: row.subscription_days || 30,
            total_amount: row.total_amount || 99,
            access_key: row.access_key
          };
        });
        
        // Фильтруем тестовых пользователей
        const filteredDonors = donors.filter(donor => {
          // Исключаем пользователей с ID 123456789 (тестовые пользователи)
          return donor.vk_id !== 123456789 && 
                 !donor.vk_name?.includes('Кутарёв') && 
                 !donor.vk_name?.includes('Кутарев');
        });
        
        console.log(`После фильтрации осталось ${filteredDonors.length} записей`);
        resolve(filteredDonors);
      } else {
        console.log('В базе данных не найдены донатеры, возвращаем пустой список');
        resolve([]);
      }
    });
  });
}

/**
 * Сохраняет список донов в базу данных
 * @param {Array} donors - Массив объектов с информацией о донах
 * @returns {Promise<boolean>} - Результат операции
 */
async function saveDonorsList(donors) {
  return new Promise(async (resolve, reject) => {
    if (!Array.isArray(donors) || donors.length === 0) {
      console.log('Пустой список донов для сохранения');
      resolve(false);
      return;
    }
    
    console.log(`Сохраняем ${donors.length} донов в базу данных...`);
    
    // Сохраняем доноры в специальной таблице для кэширования
    try {
      // Проверяем существование таблицы cached_donors
      await createCachedDonorsTableIfNotExists();
      
      // Транзакция для сохранения данных
      await runTransaction([
        // Вместо удаления всей таблицы, обновляем или добавляем каждую запись
        ...donors.map(donor => {
          return () => new Promise((res, rej) => {
            // Сначала проверяем, существует ли запись с таким vk_id
            db.get('SELECT id FROM cached_donors WHERE vk_id = ?', [donor.vk_id], (err, row) => {
              if (err) {
                console.error(`Ошибка при проверке существования дона ${donor.vk_id}:`, err);
                rej(err);
                return;
              }
              
              if (row) {
                // Если запись существует, обновляем её
                const sql = `
                  UPDATE cached_donors 
                  SET vk_name = ?, tg_id = ?, tg_name = ?, payment_date = ?,
                      subscription_days = ?, subscription_days_formatted = ?,
                      total_amount = ?, photo_url = ?, screen_name = ?, 
                      updated_at = CURRENT_TIMESTAMP
                  WHERE vk_id = ?
                `;
                
                // Вычисляем дни подписки или используем существующие
                const subscriptionDays = donor.subscription_days || 
                  calculateRemainingDays(donor.payment_date);
                
                // Форматируем строку дней подписки или используем существующую
                const formattedDays = donor.subscription_days_formatted || 
                  formatDaysString(subscriptionDays);
                
                const params = [
                  donor.vk_name || null,
                  donor.tg_id || null,
                  donor.tg_name || null,
                  donor.payment_date || null,
                  subscriptionDays,
                  formattedDays,
                  donor.total_amount || 0,
                  donor.photo_url || null,
                  donor.screen_name || null,
                  donor.vk_id
                ];
                
                db.run(sql, params, function(updateErr) {
                  if (updateErr) {
                    console.error(`Ошибка при обновлении дона ${donor.vk_id}:`, updateErr);
                    rej(updateErr);
                    return;
                  }
                  console.log(`Обновлена информация о доне ${donor.vk_id}`);
                  res();
                });
              } else {
                // Если записи нет, создаем новую
                const sql = `
                  INSERT INTO cached_donors (
                    vk_id, vk_name, tg_id, tg_name, payment_date, 
                    subscription_days, subscription_days_formatted, total_amount, photo_url, screen_name
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                // Вычисляем дни подписки или используем существующие
                const subscriptionDays = donor.subscription_days || 
                  calculateRemainingDays(donor.payment_date);
                
                // Форматируем строку дней подписки или используем существующую
                const formattedDays = donor.subscription_days_formatted || 
                  formatDaysString(subscriptionDays);
                
                const params = [
                  donor.vk_id,
                  donor.vk_name || null,
                  donor.tg_id || null,
                  donor.tg_name || null,
                  donor.payment_date || null,
                  subscriptionDays,
                  formattedDays,
                  donor.total_amount || 0,
                  donor.photo_url || null,
                  donor.screen_name || null
                ];
                
                db.run(sql, params, function(insertErr) {
                  if (insertErr) {
                    console.error(`Ошибка при создании дона ${donor.vk_id}:`, insertErr);
                    rej(insertErr);
                    return;
                  }
                  console.log(`Добавлен новый дон ${donor.vk_id}`);
                  res();
                });
              }
            });
          });
        })
      ]);
      
      console.log(`Список донов успешно сохранен: ${donors.length} записей`);
      resolve(true);
    } catch (error) {
      console.error('Ошибка при сохранении списка донов:', error);
      reject(error);
    }
  });
}

/**
 * Создает таблицу cached_donors, если она не существует
 * @returns {Promise<void>}
 */
async function createCachedDonorsTableIfNotExists() {
  return new Promise((resolve, reject) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS cached_donors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vk_id INTEGER,
        vk_name TEXT,
        tg_id INTEGER,
        tg_name TEXT,
        payment_date TEXT,
        subscription_days INTEGER DEFAULT 0,
        subscription_days_formatted TEXT,
        total_amount REAL DEFAULT 0,
        photo_url TEXT,
        screen_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    db.run(sql, (err) => {
      if (err) {
        console.error('Ошибка при создании таблицы cached_donors:', err);
        reject(err);
        return;
      }
      
      console.log('Таблица cached_donors проверена/создана');
      
      // Проверяем наличие колонки subscription_days_formatted
      db.all(`PRAGMA table_info(cached_donors)`, (err, rows) => {
        if (err) {
          console.error('Ошибка при проверке структуры таблицы cached_donors:', err);
          // Не отклоняем промис при ошибке проверки полей
          resolve();
          return;
        }
        
        // Проверяем наличие колонки subscription_days_formatted
        const hasFormattedSubscription = rows.some(row => row.name === 'subscription_days_formatted');
        
        if (!hasFormattedSubscription) {
          console.log('Добавляем колонку subscription_days_formatted в таблицу cached_donors');
          db.run("ALTER TABLE cached_donors ADD COLUMN subscription_days_formatted TEXT", (alterErr) => {
            if (alterErr) {
              console.error('Ошибка при добавлении колонки subscription_days_formatted:', alterErr);
            } else {
              console.log('Колонка subscription_days_formatted успешно добавлена');
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Получает кэшированный список донов
 * @returns {Promise<Array>} - Список донов
 */
async function getCachedDonors() {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы
      await createCachedDonorsTableIfNotExists();
      
      // Запрашиваем данные, сортируем по дате платежа (новые вверху)
      db.all('SELECT * FROM cached_donors ORDER BY payment_date DESC', (err, rows) => {
        if (err) {
          console.error('Ошибка при получении кэшированных донов:', err);
          // Если произошла ошибка, возвращаем пустой массив
          resolve([]);
          return;
        }
        
        console.log(`Получено ${rows ? rows.length : 0} кэшированных донов`);
        resolve(rows || []);
      });
    } catch (error) {
      console.error('Ошибка при запросе кэшированных донов:', error);
      resolve([]);
    }
  });
}

/**
 * Фильтрует список донов, исключая только пользователей с именем "unknown_user"
 * @param {Array} donors - Список донатеров
 * @returns {Promise<Array>} - Отфильтрованный список донатеров
 */
async function filterDonorsWithKeys(donors) {
  if (!Array.isArray(donors) || donors.length === 0) {
    return donors;
  }
  
  console.log(`Фильтруем ${donors.length} донов, включая всех реальных пользователей...`);
  
  // Фильтруем список, оставляя всех пользователей с VK ID или screen_name
  const filteredDonors = donors.filter(donor => {
    // Проверка на null/undefined для критических полей
    if (!donor) return false;
    
    // Проверяем наличие VK ID или screen_name и даты платежа
    const hasVkId = donor.vk_id && donor.vk_id !== 0;
    const hasScreenName = donor.screen_name && donor.screen_name.length > 0;
    const hasPaymentDate = donor.payment_date || donor.first_payment_date;
    
    // Проверяем, не тестовый ли это пользователь
    const isTestUser = donor.vk_id === 123456789 || 
                      (donor.vk_name && (donor.vk_name.includes('Кутарёв') || donor.vk_name.includes('Кутарев'))) ||
                      (donor.tg_name && donor.tg_name === '@unknown_user');
                      
    if (isTestUser) {
      console.log(`Исключаем тестового пользователя: ${donor.vk_name || donor.vk_id}`);
      return false;
    }
    
    // Специальная проверка для Артема Мокропулова
    if (donor.screen_name === 'artemsoooo' || 
        (donor.vk_name && donor.vk_name.includes('Артем Мокропулов'))) {
      return true;
    }
    
    // Проверяем, что пользователь не unknown_user
    const isUnknown = 
      (donor.tg_name && donor.tg_name.includes('unknown_user')) || 
      (donor.vk_name && donor.vk_name.includes('unknown_user'));
    
    // Оставляем всех пользователей с VK ID или screen_name и датой платежа
    return (hasVkId || hasScreenName) && hasPaymentDate && !isUnknown;
  });
  
  console.log(`После фильтрации осталось ${filteredDonors.length} донов, сортируем по дате платежа...`);
  
  // Сортируем по дате платежа (возрастание = самые свежие будут в конце)
  const sortedDonors = filteredDonors.sort((a, b) => {
    const dateA = new Date(a.payment_date || a.first_payment_date || 0);
    const dateB = new Date(b.payment_date || b.first_payment_date || 0);
    
    // Сортировка по возрастанию даты (старые в начале, новые в конце)
    return dateA - dateB;
  });
  
  return sortedDonors;
}

/**
 * Оптимизированное получение списка активных доноров
 * @param {boolean} forceRefresh - Принудительное обновление кэша
 * @returns {Promise<Array>} - Отфильтрованный список активных доноров
 */
async function getOptimizedDonorsList(forceRefresh = false) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Запрашиваем оптимизированный список донов...');
      
      // Получаем сумму доната из настроек или переменных окружения
      const defaultDonutAmount = process.env.VK_DONUT_AMOUNT ? 
        parseInt(process.env.VK_DONUT_AMOUNT) : 99;
      console.log(`Стандартная сумма доната из VK Donut: ${defaultDonutAmount}р`);
      
      // Если не требуется обновление, пробуем использовать кэш
      if (!forceRefresh) {
        try {
          const cachedDonors = await getCachedDonors();
          if (cachedDonors && cachedDonors.length > 0) {
            // Фильтруем только активных донов
            const activeDonors = cachedDonors.filter(donor => {
              // Исключаем unknown_user
              if (donor.tg_name && donor.tg_name.includes('unknown_user')) {
                return false;
              }
              
              // Проверяем актуальность подписки
              if (donor.payment_date) {
                const paymentDate = new Date(donor.payment_date);
                const now = new Date();
                const diffDays = Math.floor((now - paymentDate) / (1000 * 60 * 60 * 24));
                
                // Если прошло больше 30 дней - исключаем из списка
                if (diffDays > 30) {
                  console.log(`Дон ${donor.vk_name || donor.vk_id} исключен из списка (просроченная подписка)`);
                  return false;
                }
              }
              
              return true;
            });
            
            // Устанавливаем сумму доната и обрабатываем дни подписки для всех донов
            for (const donor of activeDonors) {
              // Устанавливаем сумму доната
              donor.total_amount = defaultDonutAmount;
              
              // Вычисляем и форматируем дни подписки
              const subscriptionDays = calculateRemainingDays(donor.payment_date, 30);
              donor.subscription_days = subscriptionDays;
              donor.subscription_days_formatted = formatDaysString(subscriptionDays);
              
              // Если имя пользователя не задано, но есть vk_id, пробуем получить информацию о пользователе
              if ((!donor.vk_name || donor.vk_name === `ID: ${donor.vk_id}`) && donor.vk_id) {
                try {
                  // Получаем информацию о пользователе из базы
                  const vkUserInfo = await getVkUserInfo(donor.vk_id);
                  if (vkUserInfo) {
                    donor.vk_name = `${vkUserInfo.first_name || ''} ${vkUserInfo.last_name || ''}`.trim();
                    if (donor.vk_name) {
                      // Обновляем информацию в кэше
                      updateCachedDonorVkInfo(donor.vk_id, donor.vk_name).catch(err => {
                        console.warn(`Не удалось обновить кэш для ${donor.vk_id}:`, err);
                      });
                    }
                  }
                } catch (err) {
                  console.warn(`Не удалось получить информацию о пользователе ${donor.vk_id}:`, err);
                }
              }
            }
            
            console.log(`Найдено ${activeDonors.length} активных донов в кэше`);
            resolve(activeDonors);
            return;
          }
        } catch (err) {
          console.warn('Ошибка при получении кэшированных донов:', err);
        }
      }
      
      // Получаем свежие данные
      console.log('Обновляем список донов...');
      
      // Собираем данные из VK группы 
      let vkGroupData = [];
      try {
        // Здесь может быть вызов API для получения списка пользователей группы
        console.log('Получение донов из группы VK...');
        // Реализация запроса к API группы...
      } catch (err) {
        console.warn('Ошибка при получении донов из VK:', err);
      }
      
      // Получаем данные из базы
      let databaseDonors = [];
      try {
        // Запрашиваем данные из donations или users
        const donationsResult = await new Promise((res, rej) => {
          db.all(`
            SELECT 
              d.vk_id,
              u.tg_id,
              v.first_name || ' ' || v.last_name as vk_name,
              d.payment_date,
              u.next_payment,
              COALESCE(u.total_amount, 0) as total_amount,
              v.screen_name,
              u.is_active
            FROM donations d
            LEFT JOIN users u ON d.vk_id = u.vk_id
            LEFT JOIN vk_users v ON d.vk_id = v.user_id
            GROUP BY d.vk_id
          `, [], (err, rows) => {
            if (err) rej(err);
            else res(rows || []);
          });
        });
        
        if (donationsResult.length > 0) {
          databaseDonors = donationsResult;
          console.log(`Получено ${databaseDonors.length} донов из базы данных`);
        } else {
          // Если в donations нет данных, используем users
          const usersResult = await new Promise((res, rej) => {
            db.all(`
              SELECT 
                u.vk_id,
                u.tg_id,
                v.first_name || ' ' || v.last_name as vk_name, 
                u.payment_date,
                u.next_payment,
                COALESCE(u.total_amount, 0) as total_amount,
                v.screen_name,
                u.is_active
              FROM users u
              LEFT JOIN vk_users v ON u.vk_id = v.user_id
              WHERE u.is_active = 1
              GROUP BY u.vk_id
            `, [], (err, rows) => {
              if (err) rej(err);
              else res(rows || []);
            });
          });
          
          databaseDonors = usersResult;
          console.log(`Получено ${databaseDonors.length} донов из таблицы users`);
        }
      } catch (err) {
        console.warn('Ошибка при получении донов из базы данных:', err);
      }
      
      // Если данных нет ни в базе, ни в VK, используем резервную копию
      if (databaseDonors.length === 0 && vkGroupData.length === 0) {
        console.log('Используем восстановленный список донов из резервной копии');
        const restoredDonors = await getRestoredDonors();
        
        // Фильтруем только активных донов и исключаем unknown_user
        const activeDonors = restoredDonors.filter(donor => {
          // Исключаем unknown_user
          if (donor.tg_name && donor.tg_name.includes('unknown_user')) {
            return false;
          }
          
          return true;
        });
        
        // Обрабатываем доны: устанавливаем сумму, вычисляем дни подписки, получаем имена пользователей
        for (const donor of activeDonors) {
          // Устанавливаем сумму доната
          donor.total_amount = defaultDonutAmount;
          
          // Вычисляем и форматируем дни подписки
          const subscriptionDays = calculateRemainingDays(donor.payment_date);
          donor.subscription_days = subscriptionDays;
          donor.subscription_days_formatted = formatDaysString(subscriptionDays);
          
          // Если имя пользователя не задано или это ID, пробуем получить информацию
          if ((!donor.vk_name || donor.vk_name === `ID: ${donor.vk_id}`) && donor.vk_id) {
            try {
              const vkUserInfo = await getVkUserInfo(donor.vk_id);
              if (vkUserInfo && (vkUserInfo.first_name || vkUserInfo.last_name)) {
                donor.vk_name = `${vkUserInfo.first_name || ''} ${vkUserInfo.last_name || ''}`.trim();
              }
            } catch (vkErr) {
              console.warn(`Не удалось получить информацию о пользователе ${donor.vk_id}:`, vkErr);
            }
          }
        }
        
        // Сохраняем в кэш
        await saveDonorsList(activeDonors);
        
        console.log(`Восстановлено ${activeDonors.length} активных донов`);
        resolve(activeDonors);
        return;
      }
      
      // Объединяем данные
      const combinedDonors = [...databaseDonors];
      
      // Добавляем пользователей из VK, которых нет в базе
      if (vkGroupData.length > 0) {
        for (const vkUser of vkGroupData) {
          if (!combinedDonors.some(d => d.vk_id === vkUser.vk_id)) {
            combinedDonors.push({
              vk_id: vkUser.vk_id,
              vk_name: vkUser.name,
              // Остальные поля по умолчанию
              payment_date: new Date().toISOString(),
              is_active: 1
            });
          }
        }
      }
      
      // Фильтруем только активных донов
      const activeDonors = combinedDonors.filter(donor => {
        // Исключаем unknown_user
        if (donor.tg_name && donor.tg_name.includes('unknown_user')) {
          return false;
        }
        
        // Проверяем next_payment, если указан
        if (donor.next_payment) {
          const nextPayment = new Date(donor.next_payment);
          if (nextPayment < new Date()) {
            console.log(`Дон ${donor.vk_name || donor.vk_id} исключен из списка (истек срок подписки)`);
            return false;
          }
        }
        
        // Проверяем флаг активности, если он есть
        if (donor.is_active === 0) {
          console.log(`Дон ${donor.vk_name || donor.vk_id} исключен из списка (неактивен)`);
          return false;
        }
        
        return true;
      });
      
      // Обрабатываем доны: устанавливаем сумму, вычисляем дни подписки, получаем имена пользователей
      for (const donor of activeDonors) {
        // Устанавливаем сумму доната
        donor.total_amount = defaultDonutAmount;
        
        // Вычисляем и форматируем дни подписки
        const subscriptionDays = calculateRemainingDays(donor.payment_date);
        donor.subscription_days = subscriptionDays;
        donor.subscription_days_formatted = formatDaysString(subscriptionDays);
        
        // Если имя пользователя не задано или состоит только из ID, пробуем получить информацию
        if ((!donor.vk_name || donor.vk_name === `ID: ${donor.vk_id}` || donor.vk_name.trim() === '') && donor.vk_id) {
          try {
            // Запрашиваем данные о пользователе из базы
            const vkUserInfo = await getVkUserInfo(donor.vk_id);
            if (vkUserInfo && (vkUserInfo.first_name || vkUserInfo.last_name)) {
              donor.vk_name = `${vkUserInfo.first_name || ''} ${vkUserInfo.last_name || ''}`.trim();
            }
          } catch (vkErr) {
            console.warn(`Не удалось получить информацию о пользователе ${donor.vk_id}:`, vkErr);
          }
        }
      }
      
      // Сохраняем в кэш
      await saveDonorsList(activeDonors);
      
      console.log(`Итоговый список содержит ${activeDonors.length} активных донов`);
      resolve(activeDonors);
    } catch (error) {
      console.error('Ошибка при получении оптимизированного списка донов:', error);
      reject(error);
    }
  });
}

/**
 * Очистка устаревших и неактивных данных из базы и кэша
 * @param {Object} options - Опции очистки
 * @param {boolean} options.clearInactiveDonors - Удалять неактивных донов
 * @param {number} options.daysThreshold - Порог в днях для считания дона неактивным
 * @returns {Promise<Object>} - Результат очистки с количеством удаленных записей
 */
async function cleanupStaleData(options = {}) {
  const settings = {
    clearInactiveDonors: true,
    daysThreshold: 45,  // Удалять доноров неактивных более 45 дней
    ...options
  };
  
  console.log('Начинаем очистку устаревших данных...');
  let result = {
    deletedDonors: 0,
    archivedMessages: 0,
    cleanedCaches: 0,
    errors: []
  };
  
  try {
    // 1. Очистка неактивных донов из таблицы users
    if (settings.clearInactiveDonors) {
      try {
        const now = new Date();
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - settings.daysThreshold);
        
        console.log(`Удаляем донов неактивных более ${settings.daysThreshold} дней (до ${thresholdDate.toISOString()})...`);
        
        // Сначала отмечаем их как неактивные
        const deactivateResult = await new Promise((resolve, reject) => {
          db.run(
            `UPDATE users SET is_active = 0 
             WHERE (next_payment < ? OR payment_date < ?) 
             AND is_active = 1`,
            [thresholdDate.toISOString(), thresholdDate.toISOString()],
            function(err) {
              if (err) reject(err);
              else resolve({ deactivated: this.changes });
            }
          );
        });
        
        console.log(`Деактивировано ${deactivateResult.deactivated} просроченных доноров`);
        result.deletedDonors += deactivateResult.deactivated;
        
        // Удаляем unknown_user из кэша
        await createCachedDonorsTableIfNotExists();
        
        const deleteUnknownResult = await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM cached_donors 
             WHERE tg_name LIKE '%unknown_user%'`,
            function(err) {
              if (err) reject(err);
              else resolve({ deleted: this.changes });
            }
          );
        });
        
        console.log(`Удалено ${deleteUnknownResult.deleted} донов с тегом unknown_user из кэша`);
        result.deletedDonors += deleteUnknownResult.deleted;
      } catch (err) {
        console.error('Ошибка при очистке неактивных донов:', err);
        result.errors.push({source: 'donors_cleanup', error: err.message});
      }
    }
    
    // 2. Архивация старых сообщений
    try {
      const archiveResult = await archiveMessages({
        beforeDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 дней
        onlyRead: true
      });
      
      console.log(`Архивировано ${archiveResult.count} старых сообщений`);
      result.archivedMessages = archiveResult.count;
    } catch (err) {
      console.error('Ошибка при архивации старых сообщений:', err);
      result.errors.push({source: 'archive_messages', error: err.message});
    }
    
    // 3. Обновляем кэш донов, удаляя неактивных
    try {
      const allDonors = await getOptimizedDonorsList(true); // Принудительное обновление кэша
      console.log(`Кэш донов обновлен, активных донов: ${allDonors.length}`);
      result.cleanedCaches++;
    } catch (err) {
      console.error('Ошибка при обновлении кэша донов:', err);
      result.errors.push({source: 'cache_update', error: err.message});
    }
    
    console.log('Очистка устаревших данных завершена');
    return result;
  } catch (error) {
    console.error('Ошибка при очистке устаревших данных:', error);
    result.errors.push({source: 'general', error: error.message});
    return result;
  }
}

// Обновляем экспортируемые функции
module.exports = {
  // ... существующие экспорты
  initDatabase,
  savePayment,
  checkAccessKey,
  checkAccessKeyWithUser,
  updateKeyUsed,
  keyExists,
  deactivateExpiredSubscriptions,
  getInactiveUsers,
  addPendingUser,
  approvePendingUser,
  isPendingApproved,
  getAllPendingUsers,
  getUserKey,
  getUserKeyByTgId,
  isTgUserRegistered,
  addTestUser,
  updateUsersTableStructure,
  getAllDonors,
  getUsersAsDonors,
  saveTelegramUser,
  saveUserMessage,
  getUserMessageById,
  getUnreadMessages,
  getLatestUserMessages,
  getUserMessageHistory,
  markMessageAsRead,
  markAllUserMessagesAsRead,
  getUnreadMessagesCount,
  getUnreadMessagesWithPagination,
  getAllMessagesCount,
  getAllMessagesWithPagination,
  cleanupOldMessages,
  isUserBlocked,
  blockUser,
  unblockUser,
  getBlockedUsers,
  createAdminDialog,
  closeAdminDialog,
  hasActiveDialog,
  getAdminActiveDialog,
  getAdminRecentUsers,
  getAllAdminDialogsWithUser,
  getAdminDialogBetween,
  createBackup,
  cleanupOldBackups,
  scheduleBackups,
  getTelegramUserInfo,
  getVkUserInfo,
  saveVkUser,
  getUserById,
  archiveMessages,
  getMessagesWithFilters,
  getUsersWithMessages,
  getMessagesStatistics,
  countAllDonors,
  countTelegramUsers,
  getRestoredDonors,
  saveDonorsList,
  createCachedDonorsTableIfNotExists,
  getCachedDonors,
  filterDonorsWithKeys,
  getOptimizedDonorsList,
  cleanupStaleData,
  updateCachedDonorTgInfo,
  updateCachedDonorVkInfo,
  getAllCachedDonors,
  getAllAccessKeys,
  formatDaysString,
  calculateRemainingDays
}; 

// Обновление информации о Telegram пользователе в кэше донов
function updateCachedDonorTgInfo(vkId, tgId, tgName) {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы
      await createCachedDonorsTableIfNotExists();
      
      // Обновляем информацию
      db.run(
        `UPDATE cached_donors 
         SET tg_id = ?, tg_name = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE vk_id = ?`,
        [tgId, tgName, vkId],
        function(err) {
          if (err) {
            console.error('Ошибка при обновлении Telegram информации в кэше донов:', err);
            reject(err);
          } else {
            console.log(`Обновлена Telegram информация для VK ID ${vkId}: tg_id=${tgId}, tg_name=${tgName}`);
            resolve({ changes: this.changes });
          }
        }
      );
    } catch (error) {
      console.error('Ошибка при обновлении cached_donors:', error);
      reject(error);
    }
  });
}

// Обновление информации о VK пользователе в кэше донов
function updateCachedDonorVkInfo(vkId, vkName) {
  return new Promise(async (resolve, reject) => {
    try {
      // Проверяем существование таблицы
      await createCachedDonorsTableIfNotExists();
      
      // Обновляем информацию
      db.run(
        `UPDATE cached_donors 
         SET vk_name = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE vk_id = ?`,
        [vkName, vkId],
        function(err) {
          if (err) {
            console.error('Ошибка при обновлении VK информации в кэше донов:', err);
            reject(err);
          } else {
            console.log(`Обновлена VK информация для ID ${vkId}: vk_name=${vkName}`);
            resolve({ changes: this.changes });
          }
        }
      );
    } catch (error) {
      console.error('Ошибка при обновлении cached_donors:', error);
      reject(error);
    }
  });
}

/**
 * Получает сообщения с применением фильтров
 * @param {Object} params - Параметры фильтрации
 * @param {Date|null} params.beforeDate - Дата, до которой выбрать сообщения
 * @param {boolean} params.onlyRead - Выбрать только прочитанные
 * @param {number|null} params.userId - ID пользователя
 * @returns {Promise<Array>} - Массив отфильтрованных сообщений
 */
function getMessagesWithFilters(params = {}) {
  return new Promise((resolve, reject) => {
    // Строим условия SQL запроса на основе параметров
    const conditions = [];
    const queryParams = [];
    
    if (params.beforeDate) {
      const dateStr = params.beforeDate.toISOString();
      conditions.push("um.created_at < ?");
      queryParams.push(dateStr);
    }
    
    if (params.onlyRead) {
      conditions.push("um.is_read = 1");
    }
    
    if (params.userId) {
      conditions.push("um.tg_id = ?");
      queryParams.push(params.userId);
    }
    
    // Формируем SQL запрос
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT 
        um.id,
        um.tg_id,
        um.message_text,
        um.message_id,
        um.is_read,
        um.message_type,
        um.from_admin,
        um.created_at,
        tu.username,
        tu.first_name,
        tu.last_name
      FROM user_messages um
      LEFT JOIN tg_users tu ON um.tg_id = tu.user_id
      ${whereClause}
      ORDER BY um.created_at DESC
    `;
    
    // Выполняем запрос
    db.all(sql, queryParams, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Получение всех доноров из кэша
 * @returns {Promise<Array>} Список всех доноров
 */
function getAllCachedDonors() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM cached_donors', [], (err, rows) => {
      if (err) {
        console.error('Ошибка при получении кэшированных доноров:', err);
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

/**
 * Получение всех ключей доступа
 * @returns {Promise<Array>} Список всех ключей доступа
 */
function getAllAccessKeys() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        ak.access_key,
        ak.vk_id,
        ak.tg_id,
        ak.payment_date,
        ak.used,
        ak.total_amount as amount,
        30 as subscription_days,
        vk.first_name AS vk_first_name,
        vk.last_name AS vk_last_name,
        tg.first_name AS tg_first_name,
        tg.last_name AS tg_last_name,
        tg.username AS tg_username
      FROM users ak
      LEFT JOIN vk_users vk ON ak.vk_id = vk.user_id
      LEFT JOIN tg_users tg ON ak.tg_id = tg.user_id
    `, [], (err, rows) => {
      if (err) {
        console.error('Ошибка при получении ключей доступа:', err);
        reject(err);
      } else {
        // Преобразуем результаты для удобного использования
        const processedRows = (rows || []).map(row => {
          let vk_name = null;
          if (row.vk_first_name || row.vk_last_name) {
            vk_name = `${row.vk_first_name || ''} ${row.vk_last_name || ''}`.trim();
          }
          
          let tg_name = null;
          if (row.tg_username) {
            tg_name = `@${row.tg_username}`;
          } else if (row.tg_first_name || row.tg_last_name) {
            tg_name = `${row.tg_first_name || ''} ${row.tg_last_name || ''}`.trim();
          }
          
          return {
            access_key: row.access_key,
            vk_id: row.vk_id,
            vk_name: vk_name,
            tg_id: row.tg_id,
            tg_name: tg_name,
            payment_date: row.payment_date,
            used: row.used,
            amount: row.amount,
            subscription_days: row.subscription_days
          };
        });
        
        resolve(processedRows);
      }
    });
  });
}

/**
 * Получение информации о пользователе Telegram из базы данных
 * @param {number} userId - ID пользователя Telegram
 * @returns {Promise<Object>} Информация о пользователе
 */
function getTelegramUserInfo(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM tg_users WHERE user_id = ?', [userId], (err, row) => {
      if (err) {
        console.error(`Ошибка при получении информации о пользователе Telegram ${userId}:`, err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Обновляем экспортируемые функции
module.exports = {
  // ... существующие экспорты
  initDatabase,
  savePayment,
  checkAccessKey,
  checkAccessKeyWithUser,
  updateKeyUsed,
  keyExists,
  deactivateExpiredSubscriptions,
  getInactiveUsers,
  addPendingUser,
  approvePendingUser,
  isPendingApproved,
  getAllPendingUsers,
  getUserKey,
  getUserKeyByTgId,
  isTgUserRegistered,
  addTestUser,
  updateUsersTableStructure,
  getAllDonors,
  getUsersAsDonors,
  saveTelegramUser,
  saveUserMessage,
  getUserMessageById,
  getUnreadMessages,
  getLatestUserMessages,
  getUserMessageHistory,
  markMessageAsRead,
  markAllUserMessagesAsRead,
  getUnreadMessagesCount,
  getUnreadMessagesWithPagination,
  getAllMessagesCount,
  getAllMessagesWithPagination,
  cleanupOldMessages,
  isUserBlocked,
  blockUser,
  unblockUser,
  getBlockedUsers,
  createAdminDialog,
  closeAdminDialog,
  hasActiveDialog,
  getAdminActiveDialog,
  getAdminRecentUsers,
  getAllAdminDialogsWithUser,
  getAdminDialogBetween,
  createBackup,
  cleanupOldBackups,
  scheduleBackups,
  getTelegramUserInfo,
  getVkUserInfo,
  saveVkUser,
  getUserById,
  archiveMessages,
  getMessagesWithFilters,
  getUsersWithMessages,
  getMessagesStatistics,
  countAllDonors,
  countTelegramUsers,
  getRestoredDonors,
  saveDonorsList,
  createCachedDonorsTableIfNotExists,
  getCachedDonors,
  filterDonorsWithKeys,
  getOptimizedDonorsList,
  cleanupStaleData,
  updateCachedDonorTgInfo,
  updateCachedDonorVkInfo,
  getAllCachedDonors,
  getAllAccessKeys
};

/**
 * Форматирует количество дней в читаемый вид (1 день, 2 дня, 5 дней)
 * @param {number} days - Количество дней
 * @returns {string} - Отформатированная строка
 */
function formatDaysString(days) {
  if (days === 0) {
    return "менее 1 дн";
  }
  
  if (days === 1) {
    return "1 день";
  }
  
  if (days > 1 && days < 5) {
    return `${days} дня`;
  }
  
  return `${days} дней`;
}

/**
 * Вычисляет количество дней, прошедших с момента начала подписки
 * @param {string} paymentDate - Дата начала подписки
 * @param {number} subscriptionDays - Общее количество дней подписки (обычно 30)
 * @returns {number} - Количество прошедших дней (0 - если "менее 1 дня")
 */
function calculateRemainingDays(paymentDate, subscriptionDays = 30) {
  if (!paymentDate) {
    return 0;
  }
  
  const startDate = new Date(paymentDate);
  const now = new Date();
  
  // Если дата в будущем (ошибка), считаем как новую подписку
  if (startDate > now) {
    return 0;
  }
  
  // Расчет прошедших дней
  const diffTime = Math.abs(now - startDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  // Если прошло 0 дней - значит "менее 1 дня"
  if (diffDays === 0) {
    return 0;
  }
  
  // Если прошло больше дней чем период подписки - подписка закончилась
  if (diffDays >= subscriptionDays) {
    return 0;
  }
  
  // Возвращаем количество прошедших дней
  return diffDays;
}