'use strict';

/*!
* Module dependencies.
*/
const Debug = require('debug');                 // https://github.com/visionmedia/debug
const utilities = require(__dirname + '/utilities.js');


/**
 * Class for webhook stuff, e.g subscribe all webhooks
 * @alias shopify-server/Webhook
 */
class Webhook {

  /**
   * Create the webhook object
   */
  constructor() {
    this.debug = new Debug('shopify-server:Webhook');

    /**
     * All avaiable webhook topics
     * @see https://help.shopify.com/api/reference/webhook
     * @name Webhook#topics
     * @type string[]
     */
    this.topics = [
      'carts/create',
      'carts/update',
      'checkouts/create',
      'checkouts/delete',
      'checkouts/update',
      'collections/create',
      'collections/delete',
      'collections/update',
      'collection_listings/add',
      'collection_listings/remove',
      'collection_listings/update',
      'customers/create',
      'customers/delete',
      'customers/disable',
      'customers/enable',
      'customers/update',
      'customer_groups/create',
      'customer_groups/delete',
      'customer_groups/update',
      'draft_orders/create',
      'draft_orders/delete',
      'draft_orders/update',
      'fulfillments/create',
      'fulfillments/update',
      'fulfillment_events/create',
      'fulfillment_events/delete',
      'orders/cancelled',
      'orders/create',
      'orders/delete',
      'orders/fulfilled',
      'orders/paid',
      'orders/partially_fulfilled',
      'orders/updated',
      'order_transactions/create',
      'products/create',
      'products/delete',
      'products/update',
      'product_listings/add',
      'product_listings/remove',
      'product_listings/update',
      'refunds/create',
      'app/uninstalled',
      'shop/update',
      'themes/create',
      'themes/delete',
      'themes/publish',
      'themes/update',
    ];
  };

  /**
   * subscribe all webhooks defined in opts.topics, if opts.topics is not defined, all webhooks will be subscribed.
   *
   * ## Subscribe / Receive Webhooks
   *
   * To **subscribe** webhooks on your local system are a special case,
   * webhooks need your public ip address and you need to make this app public available in the internet.
   *
   * To make this app public you need to foreward the ssl port 443 on your router to your local device like this:
   *
   * * protocol: tcp
   * * port: 443
   * * device / ip: device name or local ip of your device
   * * to port: 443
   *
   * To let this app know what your public ip is, it is detected with [environmentService.getAddress()](services/environment.js)
   * and used for the webhook subscription automatically.
   *
   * ## Multiple app insteance
   *
   * Another problematic thing is, that just one insteance of this app can *receive* a webhook of a specific topic and shopify shop,
   * so if *more than one* are working on this app locally it could happen that the webhook subscriptions overwrite each other.
   *
   * ## Create / Update Webhooks
   *
   * If you create a webhook, the webhook is saved until you delete them, even if you restart this app.
   * Webhooks are only deleted automatically if this "app has been offline for more than 48 hours".
   * So if your public ip changes, you need to update all webhooks
   * and if you restart this app you need to check which webhooks already exist befor you try to create them.
   *
   * ## Disable Subscrition
   * You can disable the subscriotion by setting he Enviroment Variable `DISABLE_WEBHOOKS_SUBSCRIPTION=all`
   *
   * @param {Object} opts Options
   * @param {Array} shops
   * @return {Promise}
   */
  subscribe(opts, shops) {
    if(process.env.DISABLE_WEBHOOKS_SUBSCRIPTION === 'all') {
      const message = 'webhook subscription disabled';
      this.debug(message);
      return Promise.resolve(message);
    }

    this.debug('subscribe webhooks', 'options', opts);

    if(opts === null || typeof(opts) !== 'object') {
      opts = {};
    }

    if(typeof(opts.appName) !== 'string') {
      throw new Error('app name string is required');
    }

    if(typeof(opts.address) !== 'string') {
      throw new Error('address string is required');
    }

    if(!utilities.isArray(shops)) {
      throw new Error('shops array is required');
    }

    if(!utilities.isArray(opts.topics)) {
      opts.topics = this.topics;
    }

    let createWebhooks = [];

    /*
     * Prepair webhooks for create / update
     */
    for (let g = 0; g < opts.topics.length; g++) {
      const topic = opts.topics[g];
      const routeURL = `/webhook/${opts.appName}/${topic}`;
      const webhookUrl = `${opts.address}${routeURL}`;

      const params = {
        'topic': topic,
        'address': webhookUrl,
        'format': 'json',
      };

      let needSalesChannelSDK = false;
      if(topic === 'collection_listings/remove'
      || topic === 'collection_listings/update'
      || topic === 'collection_listings/add'
      || topic === 'product_listings/add'
      || topic === 'product_listings/update'
      || topic === 'product_listings/remove') {
        needSalesChannelSDK = true;
      }

      createWebhooks.push({
        needUpdate: false,
        needSalesChannelSDK: needSalesChannelSDK,
        params: params,
      });
    }

    /*
     * Get all webhooks for all shops and check if topics need an update or an creation
     */
    return utilities.pMap(shops, (shop, index) => {
      const api = shop.api;
      /*
       * Get all webhooks for one shop (shops[i])
       */
      api.webhook.list()
      .then((existingWebhooks) => {
        return utilities.pMap(createWebhooks, (createWebhook, index) => {
          for (let k = 0; k < existingWebhooks.length; k++) {
            let existingWebhook = existingWebhooks[k];
            this.debug(`compare webhooks: `, existingWebhook, createWebhook);
            if(existingWebhook.topic === createWebhook.params.topic) {
              createWebhook.needUpdate = true;
              createWebhook.params.id = existingWebhook.id;
            }
          }
          return createWebhook;
        }).then((createWebhooks) => {
          this.debug(`createWebhooks`, createWebhooks);
          return utilities.pMap(createWebhooks, (createWebhook, index) => {
            if(createWebhook.needSalesChannelSDK) {
              this.debug(`ignore webhook because it needs the Sales Channel SDK: ${createWebhook.params.topic}`);
              return Promise.resolve();
            }
            if(createWebhook.needUpdate) {
              this.debug(`update webhook: ${createWebhook.params.topic}`);
              return api.webhook.update(createWebhook.params.id, createWebhook.params)
              .catch((error) => {
                console.error(`error on update webhook ${createWebhook.params.topic} - ${error.hostname}`);
                return error;
              });
            } else {
              this.debug(`create webhook: ${createWebhook.params.topic}`);
              return api.webhook.create(createWebhook.params)
              .catch((error) => {
                console.error(`error on create webhook ${createWebhook.params.topic} - ${error.hostname}`);
                return error;
              });
            }
          });
        });
      });
    });
  };

  /**
   * Koa middleware for shopify webhooks
   * Create routes to resive webhooks defined in opts.topics.
   * If opts.topics is not defined, this middleware will create routes for all webhooks.
   * @requires koa-router
   * @param {Object} opts
   * @param {Object} app
   * @param {Array} shops
   * @param {Object} controller
   * @return {Object} router
   */
  koa(opts, app, shops, controller) {
    const Router = require('koa-router'); // https://github.com/alexmingoia/koa-router/tree/master/
    const router = new Router();

    this.debug('init koa middleware', 'options', opts);

    if(opts === null || typeof(opts) !== 'object') {
      opts = {};
    }

    if(typeof(opts.appName) !== 'string') {
      throw new Error('app name string is required');
    }

    if(typeof(opts.address) !== 'string') {
      throw new Error('address string is required');
    }

    if(typeof(controller) === 'undefined') {
      throw new Error('controller object is required');
    }

    if(typeof(opts.baseUrl) !== 'string') {
      opts.baseUrl = `/webhook/${opts.appName}`;
    }

    if(typeof(opts.controllerMethodsInCamelCase) !== 'boolean') {
      opts.controllerMethodsInCamelCase = false;
    }

    if(!utilities.isArray(opts.topics)) {
      opts.topics = this.topics;
    }

    for (let i = 0; i < opts.topics.length; i++) {
      const topic = opts.topics[i];
      const tmp = topic.split('/');
      const ressource = tmp[0];
      const action = tmp[1];
      const routeURL = `/webhook/${opts.appName}/${topic}`;
      this.debug(`init route: ${routeURL}`, ressource, action);
      /*
       * Route to recive the webhook
       */
      let controllerMethod = null;
      if(opts.controllerMethodsInCamelCase) {
        let methodName = utilities.ressourceActionToCamelCase(ressource, action);
        this.debug('methodName', methodName);
        controllerMethod = controller[utilities.ressourceActionToCamelCase(ressource, action)];
      } else {
        controllerMethod = controller[ressource][action];
      }

      router.post(routeURL, controllerMethod);
    }
    return router;
  };
}

/**
 * shopify webhook helpers
 * @module shopify-server/webhook
 * @see {@link Webhook}
 */
module.exports = Webhook;
