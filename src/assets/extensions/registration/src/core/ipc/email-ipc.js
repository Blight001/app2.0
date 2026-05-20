const { DEFAULT_EMAIL_HOST, DEFAULT_EMAIL_PORT } = require('../email/email-defaults');

module.exports = function registerEmailHandlers({ app, ipcMain }) {
    ipcMain.handle('email-connect', async (_event, payload = {}) => {
        try {
            const host = typeof payload.host === 'string' && payload.host.trim()
                ? payload.host.trim()
                : DEFAULT_EMAIL_HOST;
            const port = Number.parseInt(payload.port, 10);
            const resolvedPort = Number.isFinite(port) ? port : DEFAULT_EMAIL_PORT;

            if (typeof app.emailClient.setLogger === 'function') {
                app.emailClient.setLogger(app.logger);
            }

            app.emailClient.serverHost = host;
            app.emailClient.serverPort = resolvedPort;

            app.logger.info(`尝试连接邮箱: ${host}:${resolvedPort}`);
            await app.emailClient.connect();

            return {
                success: true,
                status: app.emailClient.getConnectionStatus()
            };
        } catch (error) {
            app.logger.error(`连接邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('email-disconnect', async () => {
        try {
            if (typeof app.emailClient.setLogger === 'function') {
                app.emailClient.setLogger(app.logger);
            }

            app.emailClient.disconnect();
            return {
                success: true,
                status: app.emailClient.getConnectionStatus()
            };
        } catch (error) {
            app.logger.error(`断开邮箱失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
};
