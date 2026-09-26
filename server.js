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
const ADMIN_ID = String(process.env.ADMIN_ID || "");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL topilmadi");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "web")));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "web", "index.html")
  );
});


/* =========================
   DATABASE
========================= */

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auctions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      image TEXT,
      start_price BIGINT DEFAULT 0,
      current_price BIGINT DEFAULT 0,
      highest_bidder BIGINT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bids (
      id SERIAL PRIMARY KEY,
      auction_id INTEGER REFERENCES auctions(id) ON DELETE CASCADE,
      telegram_id BIGINT NOT NULL,
      amount BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      stars INTEGER NOT NULL,
      coins INTEGER NOT NULL,
      payment_id TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database tayyor");
}


/* =========================
   TELEGRAM INIT DATA
========================= */

function getTelegramUser(initData) {

  if (!initData) return null;

  const params =
    new URLSearchParams(initData);

  const hash =
    params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString =
    [...params.entries()]
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(([key, value]) =>
        `${key}=${value}`
      )
      .join("\n");

  const secretKey =
    crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(BOT_TOKEN)
      .digest();

  const calculatedHash =
    crypto
      .createHmac(
        "sha256",
        secretKey
      )
      .update(dataCheckString)
      .digest("hex");

  if (
    calculatedHash.length !==
    hash.length
  ) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hash)
    )
  ) {
    return null;
  }

  try {

    return JSON.parse(
      params.get("user")
    );

  } catch {

    return null;

  }
}


/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {

  try {

    const telegramUser =
      getTelegramUser(
        req.body.initData
      );

    if (!telegramUser) {
      return res.status(401).json({
        success: false,
        message:
          "Telegram user aniqlanmadi"
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO users
          (
            telegram_id,
            username,
            first_name
          )
        VALUES
          ($1, $2, $3)

        ON CONFLICT (telegram_id)

        DO UPDATE SET
          username =
            EXCLUDED.username,
          first_name =
            EXCLUDED.first_name

        RETURNING *
        `,
        [
          telegramUser.id,
          telegramUser.username || null,
          telegramUser.first_name ||
            "Player"
        ]
      );

    const user =
      result.rows[0];

    res.json({

      success: true,

      user: {

        id:
          user.telegram_id,

        username:
          user.username,

        first_name:
          user.first_name,

        coins:
          Number(user.coins),

        energy:
          user.energy,

        hp:
          user.hp,

        wins:
          user.wins,

        losses:
          user.losses

      }

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});


/* =========================
   TAP
========================= */

app.post("/api/tap", async (req, res) => {

  try {

    const telegramUser =
      getTelegramUser(
        req.body.initData
      );

    if (!telegramUser) {
      return res.status(401).json({
        success: false
      });
    }

    const result =
      await pool.query(
        `
        UPDATE users

        SET
          coins = coins + 1,
          energy =
            GREATEST(energy - 1, 0)

        WHERE telegram_id = $1

        RETURNING coins, energy
        `,
        [telegramUser.id]
      );

    res.json({

      success: true,

      coins:
        Number(
          result.rows[0].coins
        ),

      energy:
        result.rows[0].energy

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});


/* =========================
   COMBAT
========================= */

app.post(
  "/api/combat",
  async (req, res) => {

    try {

      const telegramUser =
        getTelegramUser(
          req.body.initData
        );

      if (!telegramUser) {
        return res.status(401).json({
          success: false
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false
        });
      }

      const user =
        result.rows[0];

      if (user.energy < 10) {

        return res.json({
          success: false,
          message:
            "Energy yetarli emas"
        });

      }

      const playerAttack =
        Math.floor(
          Math.random() * 50
        ) + 20;

      const enemyAttack =
        Math.floor(
          Math.random() * 40
        ) + 10;

      const win =
        playerAttack >= enemyAttack;

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
          SELECT
            coins,
            energy,
            wins,
            losses
          FROM users
          WHERE telegram_id = $1
          `,
          [telegramUser.id]
        );

      const u =
        updated.rows[0];

      res.json({

        success: true,

        win,

        playerAttack,

        enemyAttack,

        reward:
          win ? 25 : 0,

        coins:
          Number(u.coins),

        energy:
          u.energy,

        wins:
          u.wins,

        losses:
          u.losses

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);


/* =========================
   RATING
========================= */

app.post(
  "/api/rating",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
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

  }
);


/* =========================
   AUCTION LIST
========================= */

app.post(
  "/api/auctions",
  async (req, res) => {

    try {

      const telegramUser =
        getTelegramUser(
          req.body.initData
        );

      if (!telegramUser) {

        return res.status(401).json({
          success: false
        });

      }

      const result =
        await pool.query(`
          SELECT
            id,
            name,
            image,
            start_price,
            current_price,
            highest_bidder
          FROM auctions
          WHERE active = TRUE
          ORDER BY created_at DESC
        `);

      res.json({

        success: true,

        auctions:
          result.rows.map(a => ({

            id: a.id,

            name: a.name,

            image: a.image,

            start_price:
              Number(
                a.start_price
              ),

            current_price:
              Number(
                a.current_price
              )

          }))

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);


/* =========================
   AUCTION BID
========================= */

app.post(
  "/api/auction/bid",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const telegramUser =
        getTelegramUser(
          req.body.initData
        );

      if (!telegramUser) {

        return res.status(401).json({
          success: false
        });

      }

      const auctionId =
        Number(
          req.body.auctionId
        );

      const amount =
        Number(
          req.body.amount
        );

      await client.query(
        "BEGIN"
      );

      const auctionResult =
        await client.query(
          `
          SELECT *
          FROM auctions
          WHERE id = $1
          AND active = TRUE
          FOR UPDATE
          `,
          [auctionId]
        );

      if (!auctionResult.rows.length) {
        throw new Error(
          "Auksion topilmadi"
        );
      }

      const auction =
        auctionResult.rows[0];

      const minimum =
        Math.max(
          Number(
            auction.start_price
          ),
          Number(
            auction.current_price
          ) + 1
        );

      if (amount < minimum) {

        throw new Error(
          `Minimal taklif: ${minimum} coin`
        );

      }

      const userResult =
        await client.query(
          `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [telegramUser.id]
        );

      const user =
        userResult.rows[0];

      if (
        Number(user.coins) <
        amount
      ) {

        throw new Error(
          "Coin yetarli emas"
        );

      }

      await client.query(
        `
        UPDATE auctions

        SET
          current_price = $1,
          highest_bidder = $2

        WHERE id = $3
        `,
        [
          amount,
          telegramUser.id,
          auctionId
        ]
      );

      await client.query(
        `
        INSERT INTO bids
          (
            auction_id,
            telegram_id,
            amount
          )
        VALUES
          ($1, $2, $3)
        `,
        [
          auctionId,
          telegramUser.id,
          amount
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        current_price: amount
      });

    } catch (error) {

      await client.query(
        "ROLLBACK"
      );

      res.status(400).json({
        success: false,
        message: error.message
      });

    } finally {

      client.release();

    }

  }
);


/* =========================
   ADMIN
========================= */

function isAdmin(id) {

  return (
    String(id) ===
    ADMIN_ID
  );

}


/* =========================
   ADMIN CHECK
========================= */

app.post(
  "/api/admin/check",
  async (req, res) => {

    const telegramUser =
      getTelegramUser(
        req.body.initData
      );

    if (!telegramUser) {

      return res.status(401).json({
        success: false
      });

    }

    res.json({

      success: true,

      admin:
        isAdmin(
          telegramUser.id
        )

    });

  }
);


/* =========================
   ADMIN ADD AUCTION
========================= */

app.post(
  "/api/admin/auction",
  async (req, res) => {

    try {

      const telegramUser =
        getTelegramUser(
          req.body.initData
        );

      if (!telegramUser) {

        return res.status(401).json({
          success: false
        });

      }

      if (
        !isAdmin(
          telegramUser.id
        )
      ) {

        return res.status(403).json({
          success: false,
          message:
            "Faqat admin"
        });

      }

      const name =
        String(
          req.body.name || ""
        ).trim();

      const image =
        String(
          req.body.image || ""
        ).trim();

      const startPrice =
        Number(
          req.body.startPrice || 0
        );

      if (!name) {

        return res.status(400).json({
          success: false,
          message:
            "Mahsulot nomini kiriting"
        });

      }

      const result =
        await pool.query(
          `
          INSERT INTO auctions
            (
              name,
              image,
              start_price,
              current_price
            )

          VALUES
            ($1, $2, $3, $3)

          RETURNING *
          `,
          [
            name,
            image || null,
            startPrice
          ]
        );

      res.json({
        success: true,
        auction:
          result.rows[0]
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);


/* =========================
   STARS
   1 STAR = 100 COINS
========================= */

const STAR_PACKAGES = {

  1: 100,

  5: 500,

  10: 1000,

  25: 2500,

  50: 5000,

  100: 10000

};


/* =========================
   CREATE PAYMENT
========================= */

app.post(
  "/api/payment",
  async (req, res) => {

    try {

      const telegramUser =
        getTelegramUser(
          req.body.initData
        );

      if (!telegramUser) {

        return res.status(401).json({
          success: false
        });

      }

      const stars =
        Number(
          req.body.stars
        );

      const coins =
        STAR_PACKAGES[stars];

      if (!coins) {

        return res.status(400).json({
          success: false,
          message:
            "Stars paketi noto'g'ri"
        });

      }

      const payload =
        `coin_${telegramUser.id}_${stars}_${Date.now()}`;

      await bot.sendInvoice(

        telegramUser.id,

        "🐹 UZB Xamster Coin",

        `${stars} ⭐ = ${coins} 🪙`,

        payload,

        "",

        "XTR",

        [
          {
            label:
              `${coins} CS Coin`,
            amount:
              stars
          }
        ]

      );

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "PAYMENT ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Invoice yuborilmadi"
      });

    }

  }
);


/* =========================
   PRE CHECKOUT
========================= */

bot.on(
  "pre_checkout_query",
  async query => {

    try {

      await bot.answerPreCheckoutQuery(
        query.id,
        true
      );

    } catch (error) {

      console.error(error);

    }

  }
);


/* =========================
   SUCCESS PAYMENT
========================= */

bot.on(
  "message",
  async msg => {

    if (
      !msg.successful_payment
    ) {
      return;
    }

    try {

      const payment =
        msg.successful_payment;

      const telegramId =
        msg.from.id;

      const stars =
        Number(
          payment.total_amount
        );

      const coins =
        STAR_PACKAGES[stars];

      if (!coins) {
        return;
      }

      const paymentId =
        payment.telegram_payment_charge_id;

      const exists =
        await pool.query(
          `
          SELECT id
          FROM payments
          WHERE payment_id = $1
          `,
          [paymentId]
        );

      if (exists.rows.length) {
        return;
      }

      await pool.query(
        `
        INSERT INTO payments
          (
            telegram_id,
            stars,
            coins,
            payment_id
          )
        VALUES
          ($1, $2, $3, $4)
        `,
        [
          telegramId,
          stars,
          coins,
          paymentId
        ]
      );

      await pool.query(
        `
        UPDATE users

        SET
          coins =
            coins + $1

        WHERE telegram_id = $2
        `,
        [
          coins,
          telegramId
        ]
      );

      await bot.sendMessage(

        telegramId,

        `✅ To'lov muvaffaqiyatli!\n\n` +
        `⭐ ${stars} Stars\n` +
        `🪙 +${coins} Coin`

      );

    } catch (error) {

      console.error(
        "SUCCESS PAYMENT ERROR:",
        error
      );

    }

  }
);


/* =========================
   BOT START
========================= */

bot.onText(
  /\/start/,
  async msg => {

    try {

      await bot.sendMessage(

        msg.chat.id,

        "🐹 UZB_Xamster_combat\n\n" +
        "⚔️ Combat qiling\n" +
        "🪙 Coin yig'ing\n" +
        "⭐ Stars orqali Coin oling\n" +
        "🏆 Reytingda yuqoriga chiqing",

        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "🐹 O'YINNI OCHISH",
                  web_app: {
                    url:
                      WEB_APP_URL
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

  }
);


/* =========================
   START SERVER
========================= */

async function start() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      () => {

        console.log(
          `🚀 Server ${PORT} portda ishlayapti`
        );

      }
    );

  } catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );

  }

}

start();