/* GENERATED from scripts/app-routes.json. First node is the default. */
(function () {
  const model = {
  "routes": {
    "command": [
      "inventory",
      "shipyard",
      "production",
      "logistics"
    ],
    "operations": [
      "calculator"
    ],
    "pricecheck": [
      "routes"
    ],
    "comms": [
      "forum",
      "drafts",
      "senders"
    ]
  },
  "legacyRedirects": {
    "command/overview": "command/inventory",
    "operations/orders": "operations/calculator",
    "comms/ticker": "comms/forum",
    "comms/newswire": "comms/forum"
  }
};
  Object.values(model.routes).forEach(Object.freeze);
  Object.freeze(model.routes); Object.freeze(model.legacyRedirects);
  globalThis.RHW_ROUTES = Object.freeze(model);
})();
