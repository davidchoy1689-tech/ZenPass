        // Auto-login from URL params (for demo/troubleshooting)
        (function() {
            var qs = window.location.search.substring(1);
            var params = {};
            if (qs) {
                var parts = qs.split('&');
                for (var pi2=0; pi2<parts.length; pi2++) {
                    var kv = parts[pi2].split('=');
                    var key = decodeURIComponent(kv[0]);
                    var val = kv.length > 1 ? decodeURIComponent(kv[1]) : '';
                    params[key] = val;
                }
            }
            var t = params['token'];
            if (t) {
                try {
                    localStorage.setItem('zenpass_token', t);
                    localStorage.setItem('zenpass_user', JSON.stringify({
                        name: params['name'] || 'David Choy',
                        email: params['email'] || 'david@zenpass.hk'
                    }));
                    window.history.replaceState({}, document.title, window.location.pathname.replace(window.location.search, ''));
                } catch(e) { console.error('Auto-login error:', e); }
            }

            // Show user name if logged in
            try {
                var u = JSON.parse(localStorage.getItem('zenpass_user'));
                if (u && u.name) {
                    var btn = document.getElementById('my-profile-btn');
                    if (btn) btn.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.2);font-size:13px;font-weight:700;margin-right:4px;">' + u.name.charAt(0) + '</span> ' + u.name;
                }
            } catch(e) {}

            // Role-based entry visibility
            try {
                var u = JSON.parse(localStorage.getItem('zenpass_user'));
                var role = u ? (u.role || 'student') : null;
                var studentCard = document.getElementById('role-entry-student');
                var coachCard = document.getElementById('role-entry-coach');
                var entrySection = document.getElementById('role-entry-section');

                if (role === 'coach') {
                    // Coach: hide student card, show coach card full-width
                    if (studentCard && coachCard) {
                        studentCard.style.display = 'none';
                        coachCard.style.flex = '1 1 100%';
                        coachCard.querySelector('p').textContent = '我的課程・收入・時間表管理';
                    }
                } else if (role === 'student') {
                    // Student: hide coach card, show student card full-width
                    if (studentCard && coachCard) {
                        coachCard.style.display = 'none';
                        studentCard.style.flex = '1 1 100%';
                    }
                }
                // Not logged in: show both cards (default)
            } catch(e) {}
        })();
    