/* global module */
module.exports = async function (context, documents) {
  context.bindings.events = documents.map(document => ({
    id: document.id,
    total: document.total
  }));
};
