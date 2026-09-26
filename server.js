require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "web")));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "web", "index.html")
  );
});

/* DATABASE */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      coins BIGINT DEFAULT 0,
      energy INTEGER DEFAULT 100,
      hp INTEGER DEFAULT 100,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database tayyor");
}

/* TELEGRAM USER */

function getTelegramUser(initData) {

  if (!initData) return null;

  const params = new URLSearchParams(initData);

  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) {
    return null;
  }

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

/* LOGIN */

app.post("/api/login", async (req, res) => {

  try {

    const telegramUser =
      getTelegramUser(req.body.initData);

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        message: "Telegram user aniqlanmadi"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO users
      (telegram_id, username, first_name)
      VALUES ($1, $2, $3)

      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name

      RETURNING *
      `,
      [
        telegramUser.id,
        telegramUser.username || null,
        telegramUser.first_name || "Player"
      ]
    );

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        coins: Number(user.coins),
        energy: user.energy,
        hp: user.hp,
        wins: user.wins,
        losses: user.losses
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});

/* TAP COIN */

app.post("/api/tap", async (req, res) => {

  try {

    const telegramUser =
      getTelegramUser(req.body.initData);

    if (!telegramUser) {
      return res.status(401).json({
        success: false
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        coins = coins + 1,
        energy = GREATEST(energy - 1, 0)
      WHERE telegram_id = $1
      RETURNING coins, energy
      `,
      [telegramUser.id]
    );

    res.json({
      success: true,
      coins: Number(result.rows[0].coins),
      energy: result.rows[0].energy
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});

/* RATING */

app.post("/api/rating", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        username,
        first_name,
        coins,
        wins
      FROM users
      ORDER BY coins DESC
      LIMIT 50
    `);

    res.json({
      success: true,
      rating: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});

/* COMBAT */

app.post("/api/combat", async (req, res) => {

  try {

    const telegramUser =
      getTelegramUser(req.body.initData);

    if (!telegramUser) {
      return res.status(401).json({
        success: false
      });
    }

    const userResult = await pool.query(
      `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramUser.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false
      });
    }

    const user = userResult.rows[0];

    if (user.energy < 10) {
      return res.json({
        success: false,
        message: "Energy yetarli emas"
      });
    }

    const enemyAttack =
      Math.floor(Math.random() * 40) + 10;

    const playerAttack =
      Math.floor(Math.random() * 50) + 20;

    let win = playerAttack >= enemyAttack;

    if (win) {

      await pool.query(
        `
        UPDATE users
        SET
          coins = coins + 25,
          energy = energy - 10,
          wins = wins + 1
        WHERE telegram_id = $1
        `,
        [telegramUser.id]
      );

    } else {

      await pool.query(
        `
        UPDATE users
        SET
          energy = energy - 10,
          losses = losses + 1
        WHERE telegram_id = $1
        `,
        [telegramUser.id]
      );

    }

    const updated =
      await pool.query(
        `
        SELECT coins, energy, wins, losses
        FROM users
        WHERE telegram_id = $1
        `,
        [telegramUser.id]
      );

    res.json({
      success: true,
      win,
      playerAttack,
      enemyAttack,
      reward: win ? 25 : 0,
      ...updated.rows[0],
      coins: Number(updated.rows[0].coins)
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});

/* BOT */

bot.onText(/\/start/, async (msg) => {

  try {

    await bot.sendMessage(
      msg.chat.id,

      "🐹 UZB_Xamster_combat\n\n" +
      "⚔️ Jang qiling\n" +
      "🪙 Coin yig'ing\n" +
      "🏆 Reytingda yuqoriga chiqing",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🐹 O'YINNI OCHISH",
                web_app: {
                  url: WEB_APP_URL
                }
              }
            ]
          ]
        }
      }
    );

  } catch (error) {
    console.error(error);
  }

});

/* START */

async function start() {

  await initDatabase();

  app.listen(PORT, () => {
    console.log(
      `UZB_Xamster_combat ${PORT} portda ishlayapti`
    );
  });

}

start();