/**
 * ZenPass 禪流 - Toast Notification System
 * Drop-in replacement for alert() with styled toast notifications
 * Usage: Toast.success('預約成功！'), Toast.error('失敗'), Toast.info('提示')
 * Include: <link rel="stylesheet" href="css/toast.css"> + <script src="js/toast.js"></script>
 */
(function() {
  // Create container
  var container = document.createElement('div');
  container.className = 'toast-container';
  container.id = 'toastContainer';
  document.body.appendChild(container);

  var icons = {
    success: '✅',
    error: '❌',
    info: '💡',
    warning: '⚠️'
  };

  function show(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || '💡') + '</span>' +
      '<span>' + message + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">✕</button>';

    container.appendChild(toast);

    // Auto-remove
    var timer = setTimeout(function() {
      if (toast.parentElement) {
        toast.style.animation = 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards';
        setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
      }
    }, duration);

    // Click to dismiss early
    toast.addEventListener('click', function() {
      clearTimeout(timer);
      if (toast.parentElement) {
        toast.style.animation = 'toastOut 0.3s cubic-bezier(0.4,0,0.2,1) forwards';
        setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
      }
    });
  }

  // Global API
  window.Toast = {
    success: function(msg, dur) { show(msg, 'success', dur || 4000); },
    error: function(msg, dur) { show(msg, 'error', dur || 5000); },
    info: function(msg, dur) { show(msg, 'info', dur || 4000); },
    warning: function(msg, dur) { show(msg, 'warning', dur || 4000); }
  };
})();
