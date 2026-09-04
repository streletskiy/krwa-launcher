/**
 * Script for welcome.ejs
 */
document.getElementById('welcomeButton').addEventListener('click', e => {
    loginViewOnSuccess = VIEWS.landing
    loginViewOnCancel = VIEWS.login
    loginCancelEnabled(false)
    switchView(VIEWS.welcome, VIEWS.login)
})
