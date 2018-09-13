'use strict';
const _ = require('lodash');

const handlers = {}; // 任务处理器map
const events = {}; // 任务类型map
const tasks = {}; // 任务列表
const delayEventKeyPrefix = 'delay_event_'; // 定时任务key前缀

const TRANSITION = Symbol('Application#transition');

module.exports = {
  _,

  // 事务
  async transition() {
    if (!this[TRANSITION]) {
      this[TRANSITION] = await this.model.transaction();
    }
    return this[TRANSITION];
  },
  deleteTransition() {
    this[TRANSITION] = null;
  },

  // 单号生成，暂时是日期+6位
  async getBillNumber(prefix) {
    const date = new Date();
    const key = `${prefix || 'B'}${date.getYear()}${date.getMonth()}${date.getDate()}`;
    const value = await this.redis.get('default').get(key) || 0;

    await this.redis.get('default').setex(key, 3600 * 24, Number(value) + 1);

    return `${key}${String(value).padStart(6, '0')}`;
  },

  // 检查update
  checkUpdate(arr, message) {
    if (arr.includes(0)) {
      const error = new Error(message || '保存失败，请刷新后重试！');
      error.status = 422;
      throw error;
    }
  },

  // 任务处理
  registerTaskHandler(type, handler) {
    if (!type) {
      throw new Error('type不能为空');
    }
    if (!_.isFunction(handler)) {
      throw new Error('handler类型非function');
    }
    handlers[type] = handler;
    events[type] = true;
  },
  // 创建延迟任务
  addDelayTask(type, id, body = {}, delay = 3600) {
    const key = `${delayEventKeyPrefix}${type}_${id}`;
    const taskKey = `${type}_${id}`;

    this.redis.get('default').setex(key, delay, 'delay_task', err => {
      if (err) {
        return console.log('添加延迟任务失败：', err);
      }
      console.log('添加延迟任务成功');
      tasks[taskKey] = body;
    });
  },
  // 订阅和处理延迟任务
  initDelayTask() {
    // 订阅
    this.redis.get('subscribe').psubscribe('__keyevent@0__:expired');

    // 处理
    this.redis.get('subscribe').on('pmessage', (pattern, channel, message) => {
      console.log(message);
      // 匹配key
      const result = message.match(new RegExp(`^${delayEventKeyPrefix}(${this._.keys(events).join('|')})_(\\S+)$`));

      if (result) {
        const type = result[1];
        const id = result[2];
        const handler = handlers[type];

        if (this._.isFunction(handler)) {
          const taskKey = `${type}_${id}`;
          if (tasks[taskKey]) {
            handler(id, tasks[taskKey]);
            tasks[taskKey] = null;
          } else {
            console.log(`未找到延迟任务：type=${type}, id=${id}`);
          }
        } else {
          console.log(`未找到任务处理器：type=${type}`);
        }
      }
    });
  },
};