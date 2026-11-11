(function () {
  var tabs = document.querySelectorAll('nav .tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].type = 'button';
    tabs[i].addEventListener('click', function () {
      var id = this.getAttribute('data-tab');
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].classList.toggle('active', tabs[j] === this);
      }
      var pages = document.querySelectorAll('.page');
      for (var k = 0; k < pages.length; k++) {
        pages[k].hidden = pages[k].id !== id;
      }
    });
  }
  window.addEventListener('error', function (e) {
    if (!e.filename || !/(app|cloud|engine)\.js/.test(e.filename)) return;
    var box = document.getElementById('startupError');
    if (!box) {
      box = document.createElement('p');
      box.id = 'startupError';
      box.className = 'error';
      box.setAttribute('role', 'alert');
      document.querySelector('main').prepend(box);
    }
    box.textContent =
      'บางส่วนของเว็บทำงานไม่ครบ กรุณารีเฟรช หรือเปิด URL นี้ใน Safari / Chrome โดยตรง หากยังพบปัญหา ส่งภาพข้อความนี้ให้นัท: ' +
      e.message;
  });
})();
