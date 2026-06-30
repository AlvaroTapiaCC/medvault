const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.File({
      filename: path.join(logsDir, 'access.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});

function auditLog(action, resourceType) {
  return (req, res, next) => {
    res.on('finish', () => {
      logger.info({
        userId: req.session?.userId || req.session?.pendingTotpUserId || 'anonymous',
        role: req.session?.role || 'none',
        action,
        resourceType,
        resourceId: req.params?.id || req.params?.docId || null,
        statusCode: res.statusCode,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        method: req.method,
        path: req.path
      });
    });
    next();
  };
}

module.exports = { logger, auditLog };
