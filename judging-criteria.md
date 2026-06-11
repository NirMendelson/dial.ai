# Judging Criteria — My Agent Has A Phone

Hackathon: June 11 6PM – June 12 10AM, 2026 · Tel Aviv
Scoring: 1–10 per axis, total /30, averaged across judges.

---

## 1. Real-World Impact & Market Potential — /10

**The investor lens: would this be a company?**

Does it solve a real, painful problem for a real audience, with a believable path to users and revenue?

**Dial angle:** The phone is the most universal, highest-intent channel — no install, works for anyone with a number. Reward teams that use Dial to actually reach end users and unlock a market a pure-web demo couldn't.

| Score | Meaning |
|-------|---------|
| 8–10 | Clear problem, real or simulated users reached over voice/SMS, obvious "who pays" |
| 4–6  | Fine idea but thin on audience or monetization |
| 1–4  | Clever idea with no audience, or Dial used as a gimmick disconnected from the value |

---

## 2. Technical Execution & Depth of Dial Integration — /10

**The builder lens: is it actually well-engineered?**

How robust, complete, and thoughtfully built is it? Does the demo work end-to-end, and is the architecture sound?

**Dial angle:** Depth, not presence. Reward teams wiring together multiple Dial primitives — inbound and outbound calls, SMS, event handling / wait-for, the SDK or CLI as the backbone — and handling the hard parts (latency, call/SMS state, graceful failure, real-time events). Dial as the core runtime, not one API call bolted on.

| Score | Meaning |
|-------|---------|
| 8–10 | Dial is the spine of the system, used across several capabilities, working live under demo conditions |
| 4–6  | Solid build but Dial usage is shallow or limited |
| 1–4  | One-shot SMS send, brittle demo, Dial swappable for anything |

---

## 3. Innovation & Phone-Native Creativity — /10

**The originality lens: the "I haven't seen that before" factor.**

How novel and surprising are the idea and its execution?

**Dial angle:** Reward builds only possible because of a programmable voice/SMS layer — the phone as an interface a screen can't be. An agent that negotiates on a call, voice as an accessibility unlock, autonomous agents coordinating over real numbers, SMS as a control plane. Ask: would this be impressive without the phone?

| Score | Meaning |
|-------|---------|
| 8–10 | A genuinely new interaction made possible by programmable telephony |
| 4–6  | Interesting but the phone layer feels optional |
| 1–4  | A standard app that happens to text you a confirmation |

---

## Score Bands

| Total /30 | Signal |
|-----------|--------|
| 1–9       | Weak   |
| 10–18     | Fine   |
| 19–24     | Strong |
| 25–30     | Exceptional |
