const DEFAULT_PORT = 8080;

function readPort(value = process.env.PORT) {
  const parsed = Number(value || DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

module.exports = {
  DEFAULT_PORT,
  PORT: readPort(),
  readPort
};
