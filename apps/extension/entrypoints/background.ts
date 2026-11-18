export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  });
});
