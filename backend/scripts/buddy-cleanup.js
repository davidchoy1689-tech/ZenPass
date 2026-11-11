#!/usr/bin/env node
/** 每 10 分鐘清理超時 Buddy 拼團（直接呼叫 service，不需 HTTP token） */
require("dotenv").config();
const { getDb } = require("../src/services/database");
const buddy = require("../src/routes/buddy");
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
const refundFn = stripe ? (pi) => stripe.refunds.create({ payment_intent: pi }) : null;
const r = buddy.cleanupExpired(getDb(), refundFn);
console.log(`[BUDDY CLEANUP] processed=${r.processed} expired=${r.expired.join(",")}`);
