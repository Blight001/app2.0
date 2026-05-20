const IPC_CHANNELS = Object.freeze({
    customTestAccountStart: 'custom-test-account-start',
    customTestAccountCapture: 'custom-test-account-capture',
    customTestAccountStop: 'custom-test-account-stop',
    cardDebugAction: 'card-debug-action',
    cardDebugRandomEmail: 'card-debug-random-email',
    tempEmailLoadConfig: 'temp-email-load-config',
    tempEmailSetMode: 'temp-email-set-mode',
    tempEmailSetProvider: 'temp-email-set-provider',
    tempEmailSaveProvider: 'temp-email-save-provider',
    tempEmailDeleteProvider: 'temp-email-delete-provider',
    tempEmailImportProviders: 'temp-email-import-providers',
    tempEmailOpenProvider: 'temp-email-open-provider',
    tempEmailRefreshEmail: 'temp-email-refresh-email',
    tempEmailGetEmail: 'temp-email-get-email',
    tempEmailGetCode: 'temp-email-get-code',
    tempEmailLoadApiConfig: 'temp-email-load-api-config',
    tempEmailSaveApiConfig: 'temp-email-save-api-config',
    outlookFetchContent: 'outlook-fetch-content'
});

module.exports = {
    IPC_CHANNELS
};
