/* global module */
module.exports = async function (context, messages) {
  context.bindings.records = messages.map(message => ({
    id: message.id,
    total: message.total,
    processed: true
  }));
};
