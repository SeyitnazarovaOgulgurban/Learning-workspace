let accountToken = sessionStorage.getItem('spm-session-v2') || '';
let rosterUsers = [];
let rosterCounts = {total: 0, students: 0};
let rosterLoading = false;
let rosterError = '';
let sessionGeneration = 0;

async function accountRequest(path, method = 'GET', data) {
  const response = await fetch('/api/' + path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {'X-SPM-Session': accountToken, ...(data ? {'Content-Type': 'application/json'} : {})},
    ...(data ? {body: JSON.stringify(data)} : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'unavailable');
  return payload;
}

function accountError(code) {
  const messages = {
    credentials: ['The name and ID do not match an active user.', '姓名与编号未匹配有效账户。'],
    registered: ['This user is already registered. Choose Sign in.', '此账户已注册，请选择登录。'],
    id_required: ['Enter the sign-in ID when creating a user or changing their name.', '创建用户或修改姓名时，请填写登录编号。'],
    invalid: ['Check the name, ID and role.', '请核对姓名、编号和角色。'],
    conflict: ['That name and ID may already be in use. Refresh the roster and try again.', '姓名和编号组合可能已被使用。请刷新名册后重试。'],
    stale: ['This user was changed elsewhere. Refresh the roster before trying again.', '此账户已在其他位置修改。请刷新名册后重试。'],
    missing: ['This user no longer exists. Refresh the roster.', '此用户已不存在，请刷新名册。'],
    own_admin: ['You cannot delete or remove the administrator role from your own account.', '无法删除自己的账户或取消自己的管理员角色。'],
    session: ['Your session has ended. Sign in again.', '会话已结束，请重新登录。'],
    forbidden: ['Only administrators can manage the roster.', '仅管理员可以管理名册。'],
    unavailable: ['The account service is temporarily unavailable. Try again.', '账户服务暂时不可用，请重试。'],
  };
  return t(...(messages[code] || messages.unavailable));
}

function applyAccountSession({user, counts}) {
  sessionGeneration += 1;
  db.user = user || null;
  db.role = user?.role || null;
  db.activeRosterKey = user?.key;
  rosterCounts = counts || {total: 0, students: 0};
  if (db.role !== 'admin') rosterUsers = [];
}

function endAccountSession() {
  accountToken = '';
  sessionStorage.removeItem('spm-session-v2');
  applyAccountSession({user: null});
  quizCourseFilter = '';
  authMode = 'signin';
  closeModal();
  go('dashboard');
}

async function refreshAccountSession() {
  const generation = sessionGeneration;
  try {
    const session = await accountRequest('session');
    if (generation !== sessionGeneration) return;
    if (!session.user && db.user) {
      endAccountSession();
      toast('Your session has ended. Sign in again.', '会话已结束，请重新登录。');
      return;
    }
    if (!db.user && session.user) {
      applyAccountSession(session);
      closeModal();
      go('dashboard');
    } else if (session.user && db.user.key !== session.user.key) {
      applyAccountSession(session);
      closeModal();
      go('dashboard');
    } else if (session.counts) {
      db.user = session.user; db.role = session.user.role;
      rosterCounts = session.counts;
      if (page === 'dashboard') render();
    }
  } catch {
    // Sign-in and roster actions display errors if the service is unavailable.
  }
}

async function submitRosterForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const submit = form.querySelector('button[type=submit]');
  const error = form.querySelector('#roster-error');
  error.hidden = true;
  submit.disabled = true;
  try {
    const session = await accountRequest('sign-in', 'POST', {
      name: fields.get('name'), id: fields.get('id'), mode: authMode,
    });
    if (!session.sessionToken) throw new Error('unavailable');
    accountToken = session.sessionToken;
    sessionStorage.setItem('spm-session-v2', accountToken);
    applyAccountSession(session);
    go('dashboard');
    toast('Signed in', '登录成功');
  } catch (exception) {
    error.textContent = accountError(exception.message);
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function signOut() {
  try {
    await accountRequest('sign-out', 'POST', {});
    endAccountSession();
  } catch {
    toast('Could not sign out. Try again.', '无法退出登录，请重试。');
  }
}

async function loadRosterUsers() {
  if (db.role !== 'admin' || rosterLoading) return;
  const generation = sessionGeneration;
  rosterLoading = true;
  rosterError = '';
  if (page === 'users') render();
  try {
    const result = await accountRequest('users');
    if (generation !== sessionGeneration) return;
    rosterUsers = result.users;
    rosterCounts = {total: rosterUsers.length, students: rosterUsers.filter(user => user.role === 'student').length};
  } catch (exception) {
    if (generation !== sessionGeneration) return;
    rosterError = accountError(exception.message); // Loading a page must never silently sign the user out.
  } finally {
    rosterLoading = false;
    if (page === 'users') render();
  }
}

function usersPage() {
  if (db.role !== 'admin') return emptyState(t('Access restricted','访问受限'), accountError('forbidden'));
  const add = btn(t('Add user','添加用户'), 'openUserEditor()', 'primary', 'plus');
  const refresh = btn(t('Refresh','刷新'), 'loadRosterUsers()', 'outline');
  const header = heading(t('Class roster','班级名册'), t('Manage the accounts and sign-in details used across SPM Studio.','管理 SPM Studio 全站使用的账户及登录信息。'),
    `<div class="roster-actions">${refresh}${add}</div>`);
  const rows = rosterUsers.map(user => `
    <tr>
      <td><strong>${esc(user.name)}</strong>${user.key === db.user.key ? ` <span class="badge blue">${t('You','你')}</span>` : ''}</td>
      <td>${esc(user.maskedId)}</td>
      <td>${roleLabel(user.role)}</td>
      <td><span class="badge green">${t('Active','有效')}</span></td>
      <td><div class="roster-actions">
        ${btn(t('Edit','编辑'), `openUserEditor('${user.key}')`, 'outline')}
        ${user.key !== db.user.key ? btn(t('Delete','删除'), `confirmUserDelete('${user.key}')`, 'danger') : ''}
      </div></td>
    </tr>`).join('');
  return header + (rosterError ? `<div class="notice" role="alert">${esc(rosterError)}</div>` : '') +
    (rosterLoading && !rows ? `<p class="muted" role="status">${t('Loading roster…','正在加载名册…')}</p>` : `
    <div class="table-wrap"><table><thead><tr>
      <th scope="col">${t('Name','姓名')}</th><th scope="col">${t('ID ending','编号尾号')}</th>
      <th scope="col">${t('Role','角色')}</th><th scope="col">${t('Status','状态')}</th>
      <th scope="col">${t('Actions','操作')}</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

function openUserEditor(key) {
  if (db.role !== 'admin') return;
  const user = key ? rosterUsers.find(entry => entry.key === key) : null;
  if (key && !user) return;
  const self = user?.key === db.user.key;
  const idHelp = user ? t('Leave blank to keep the current ID. Enter the ID if you change the name.', '保留当前编号可留空。修改姓名时请填写编号。')
    : t('The user signs in with this name and ID.', '用户使用此姓名和编号登录。');
  modal(user ? t('Edit user','编辑用户') : t('Add user','添加用户'), '', `
    <form onsubmit="saveRosterUser(event, '${key || ''}', ${user?.revision || 0})">
      <div class="field"><label for="user-name">${t('Full name','姓名')}</label>
        <input id="user-name" name="name" required maxlength="80" value="${esc(user?.name || '')}"></div>
      <div class="field"><label for="user-id">${t('Sign-in ID','登录编号')}${user ? ' · ' + esc(user.maskedId) : ''}</label>
        <div class="id-input-wrap"><input id="user-id" name="id" type="password" autocomplete="new-password" maxlength="24" ${user ? '' : 'required'} aria-describedby="user-id-help"><button type="button" class="icon-button" aria-label="${t('Show ID','显示编号')}" onclick="const input=document.getElementById('user-id');input.type=input.type==='password'?'text':'password';this.innerHTML=icon(input.type==='password'?'eye':'eyeOff');this.setAttribute('aria-label',input.type==='password'?'Show ID':'Hide ID')">${icon('eye')}</button></div>
        <small id="user-id-help" class="muted">${idHelp}</small></div>
      <div class="field"><label for="user-role">${t('Role','角色')}</label>
        <select id="user-role" name="role" ${self ? 'disabled' : ''}>
          ${['student','teacher','admin'].map(role => `<option value="${role}" ${user?.role === role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
        </select></div>
      ${self ? `<p class="form-note">${t('Your current session stays open. Use your updated details for future sign-ins.','当前会话将保持登录。以后请使用更新后的信息登录。')}</p>` : ''}
      <p class="auth-error" role="alert" hidden></p>
      <div class="modal-actions">
        ${btn(t('Cancel','取消'), 'closeModal()', 'outline')}
        <button class="btn primary" type="submit">${user ? t('Save changes','保存修改') : t('Add user','添加用户')}</button>
      </div>
    </form>`);
}

async function rosterMutation(form, key, method, data) {
  const submit = form.querySelector('button[type=submit]');
  const error = form.querySelector('.auth-error');
  submit.disabled = true;
  error.hidden = true;
  try {
    const result = await accountRequest(key ? 'users/' + encodeURIComponent(key) : 'users', method, data);
    if (result.signInAgain) {
      endAccountSession();
      toast('Details updated. Sign in with your new details.', '信息已更新，请使用新信息登录。');
      return;
    }
    if (result.session) applyAccountSession(result.session);
    closeModal();
    await loadRosterUsers();
    if (method === 'DELETE') toast('User deleted', '用户已删除');
    else if (key) toast('User updated', '用户已更新');
    else toast('User added', '用户已添加');
  } catch (exception) {
    if (exception.message === 'session') {
      endAccountSession();
      toast('Your session has ended. Sign in again.', '会话已结束，请重新登录。');
      return;
    }
    error.textContent = accountError(exception.message);
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function saveRosterUser(event, key, revision) {
  event.preventDefault();
  if (db.role !== 'admin') return;
  const form = event.currentTarget;
  const fields = new FormData(form);
  return rosterMutation(form, key, key ? 'PATCH' : 'POST', {
    name: fields.get('name'), id: fields.get('id'),
    role: key === db.user.key ? 'admin' : fields.get('role'), revision,
  });
}

function confirmUserDelete(key) {
  if (db.role !== 'admin' || key === db.user.key) return;
  const user = rosterUsers.find(entry => entry.key === key);
  if (!user) return;
  modal(t('Delete user','删除用户'), '', `
    <form onsubmit="deleteRosterUser(event, '${key}', ${user.revision})">
      <p><strong>${esc(user.name)}</strong> · ${esc(user.maskedId)}</p>
      <p>${t('This removes the user’s sign-in access and ends their active sessions.','删除后，该用户将无法登录，现有会话也将结束。')}</p>
      <p class="auth-error" role="alert" hidden></p>
      <div class="modal-actions">
        ${btn(t('Cancel','取消'), 'closeModal()', 'outline')}
        <button class="btn danger" type="submit">${t('Delete user','删除用户')}</button>
      </div>
    </form>`);
}

function deleteRosterUser(event, key, revision) {
  event.preventDefault();
  if (db.role !== 'admin' || key === db.user.key) return;
  return rosterMutation(event.currentTarget, key, 'DELETE', {revision});
}
