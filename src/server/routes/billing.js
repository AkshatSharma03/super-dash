import { Router } from 'express';
import { randomBytes } from 'crypto';
import express from 'express';

let stripe = null;

async function initStripe(STRIPE_SECRET_KEY) {
  if (!STRIPE_SECRET_KEY || stripe) return stripe;
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });
  return stripe;
}

export function createBillingRouter(deps) {
  const {
    requireAuth,
    stmt,
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_PRO,
    STRIPE_WEBHOOK_SECRET,
  } = deps;

  const router = Router();

  function getPlanForUser(userId) {
    const sub = stmt.subscriptionByUser.get(userId);
    if (!sub) return 'free';
    if (sub.status !== 'active') return 'free';
    return sub.plan || 'free';
  }

  router.get('/subscription', requireAuth, (req, res) => {
    if (req.user.isGuest) return res.json({ plan: 'free', status: 'active' });
    const sub = stmt.subscriptionByUser.get(req.user.id);
    if (!sub) return res.json({ plan: 'free', status: 'active' });
    res.json({
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      stripeCustomerId: sub.stripe_customer_id,
    });
  });

  router.post('/create-checkout', requireAuth, async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up to upgrade' });
    const st = await initStripe(STRIPE_SECRET_KEY);
    if (!st) return res.status(503).json({ error: 'Billing is not configured' });
    if (!STRIPE_PRICE_PRO) return res.status(503).json({ error: 'No Pro plan configured' });

    try {
      let customerId;
      const existing = stmt.subscriptionByUser.get(req.user.id);
      if (existing?.stripe_customer_id) {
        customerId = existing.stripe_customer_id;
      } else {
        const customer = await st.customers.create({
          email: req.user.email,
          name: req.user.name,
          metadata: { userId: req.user.id },
        });
        customerId = customer.id;

        if (existing) {
          stmt.updateSubscription.run(existing.plan, existing.status, existing.stripe_subscription_id, existing.current_period_end, new Date().toISOString(), req.user.id);
        } else {
          const id = `sub_${Date.now()}_${randomBytes(4).toString('hex')}`;
          stmt.insertSubscription.run(id, req.user.id, customerId, null, 'free', 'active', null, new Date().toISOString(), new Date().toISOString());
        }
      }

      const session = await st.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: STRIPE_PRICE_PRO, quantity: 1 }],
        mode: 'subscription',
        success_url: `${req.protocol}://${req.get('host')}/?upgraded=true`,
        cancel_url: `${req.protocol}://${req.get('host')}/?canceled=true`,
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('Stripe checkout error:', err.message);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  router.post('/portal', requireAuth, async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up first' });
    const st = await initStripe(STRIPE_SECRET_KEY);
    if (!st) return res.status(503).json({ error: 'Billing is not configured' });

    const sub = stmt.subscriptionByUser.get(req.user.id);
    if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

    try {
      const session = await st.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${req.protocol}://${req.get('host')}/`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error('Stripe portal error:', err.message);
      res.status(500).json({ error: 'Failed to open billing portal' });
    }
  });

  router.post('/cancel', requireAuth, async (req, res) => {
    if (req.user.isGuest) return res.status(403).json({ error: 'Please sign up first' });
    const st = await initStripe(STRIPE_SECRET_KEY);
    if (!st) return res.status(503).json({ error: 'Billing is not configured' });

    const sub = stmt.subscriptionByUser.get(req.user.id);
    if (!sub?.stripe_subscription_id) return res.status(400).json({ error: 'No active subscription' });

    try {
      await st.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      stmt.updateSubscription.run(sub.plan, 'canceling', sub.stripe_subscription_id, sub.current_period_end, new Date().toISOString(), req.user.id);
      res.json({ status: 'canceling' });
    } catch (err) {
      console.error('Stripe cancel error:', err.message);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  });

  return router;
}

export function createBillingWebhookRouter(deps) {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, stmt } = deps;

  const router = Router();

  router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    const st = await initStripe(STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = st.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const customer = await st.customers.retrieve(customerId);
          const userId = customer.metadata?.userId;
          if (!userId) break;
          stmt.updateSubscription.run('pro', 'active', subscriptionId, null, new Date().toISOString(), userId);
          break;
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object;
          const existing = stmt.subscriptionBySubId.get(sub.id);
          if (existing) {
            const periodEnd = sub.current_period_end ? Math.floor(sub.current_period_end) : null;
            const status = sub.status === 'active' ? 'active' : sub.cancel_at_period_end ? 'canceling' : sub.status;
            const plan = sub.status === 'active' ? existing.plan : 'free';
            stmt.updateSubscription.run(plan, status, sub.id, periodEnd, new Date().toISOString(), existing.user_id);
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          const existing = stmt.subscriptionBySubId.get(sub.id);
          if (existing) {
            stmt.updateSubscription.run('free', 'active', null, null, new Date().toISOString(), existing.user_id);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Webhook handler error:', err.message);
    }

    res.json({ received: true });
  });

  return router;
}
