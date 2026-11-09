const textbookCourses = new Set(['c1', 'c2', 'c6']);
let quizCourseFilter = '';

function canEditLessons() {
  return db.role === 'teacher' || db.role === 'admin';
}

function unitCount(c) {
  const planned = textbookCourses.has(c.id) ? 10 : c.chapters;
  return Math.max(planned, c.chapters, db.unitCounts?.[c.id] || 0);
}

function unitKey(c, index) {
  return c.id + ':' + index;
}

function getUnit(c, index) {
  return db.unitEdits?.[unitKey(c, index)] || curriculum[c.id]?.[index] ||
    {title: ['', ''], body: ['', ''], quiz: null, published: false};
}

function unitTitle(unit, index) {
  return txt(unit.title) || unit.title.find(Boolean) || t('Unit ' + (index + 1), '第 ' + (index + 1) + ' 单元');
}

function unitText(pair) {
  return txt(pair) || pair.find(Boolean) || '';
}

function learningProgressKey(c) {
  return textbookCourses.has(c.id) ? c.id + ':textbook' : c.id;
}

function completedUnits(c) {
  return db.completed[learningProgressKey(c)] || [];
}

function publishedIndices(c) {
  return Array.from({length: unitCount(c)}, (_, index) => index).filter(index => getUnit(c, index).published);
}

function courseProgress(c) {
  const indices = publishedIndices(c);
  if (!indices.length) return 0;
  const completed = completedUnits(c);
  return Math.round(100 * indices.filter(index => completed.includes(index)).length / indices.length);
}

function canStudyCourse(c) {
  return Boolean(db.user && c && (canEditLessons() || (db.role === 'student' && !c.draft && db.enrolled.includes(c.id))));
}

function openCourse(id, index) {
  const c = course(id);
  if (!db.user || !c || (c.draft && !canEditLessons())) return;
  if (!canStudyCourse(c)) {
    modal(esc(txt(c.title)), esc(txt(c.description)), `${cover(c)}
      <div class="toolbar"><span class="date-pill">${icon('user')}${esc(txt(c.teacher))}</span></div>
      <div class="modal-actions">${btn(t('Enroll in course','加入课程'), `enroll('${id}')`, 'primary', 'plus')}</div>`);
    return;
  }

  const count = unitCount(c);
  const published = publishedIndices(c);
  const completed = completedUnits(c);
  const selected = index ?? published.find(i => !completed.includes(i)) ?? published[0] ?? 0;
  if (!Number.isInteger(selected) || selected < 0 || selected >= count) return;
  const unit = getUnit(c, selected);
  const editor = canEditLessons();
  const visible = editor || unit.published;
  const hasBody = unit.body.some(Boolean);
  const nav = Array.from({length: count}, (_, i) => {
    const item = getUnit(c, i);
    const title = editor || item.published ? unitTitle(item, i) : t('Not published','尚未发布');
    return `<button type="button" class="${selected === i ? 'active' : ''}" aria-current="${selected === i ? 'true' : 'false'}" onclick="openCourse('${id}',${i})">
      ${icon(item.published && completed.includes(i) ? 'check' : 'file')}
      <span>${String(i + 1).padStart(2, '0')}. ${esc(title)}${editor && !item.published ? `<small>${t('Draft','草稿')}</small>` : ''}</span>
    </button>`;
  }).join('');

  const editAction = editor ? btn(t('Edit lesson','编辑课时'), `editUnit('${id}',${selected})`, 'outline') : '';
  const previewQuiz = visible && validUnitQuiz(unit.quiz) ? btn(t('Lesson quiz','课时测验'), `openUnitQuiz('${id}',${selected})`, 'outline', 'clipboard') : '';
  const noteId = learningProgressKey(c) + '-' + selected;
  const learnerActions = !editor && unit.published ? `
    <div class="field lesson-notes"><label>${t('My notes','我的笔记')}</label>
      <textarea maxlength="4000" oninput="saveNote('${id}',${selected},this.value)">${esc(db.notes?.[noteId] || '')}</textarea></div>
    ${btn(completed.includes(selected) ? t('Completed','已完成') : t('Mark complete','标记完成'), `completeLesson('${id}',${selected})`, 'primary', 'check')}` : '';
  modal(esc(txt(c.title)), esc(txt(c.teacher)), `
    ${c.draft ? `<div class="notice">${t('Draft course · visible to staff','课程草稿 · 仅教职人员可见')} ${btn(t('Publish course','发布课程'), `publishCourse('${id}')`, 'primary')}</div>` : ''}
    <div class="lesson-layout">
      <div><nav class="lesson-nav" aria-label="${t('Course units','课程单元')}">${nav}</nav>
        ${editor && count < 30 ? `<div class="add-unit">${btn(t('Add unit','添加单元'), `addUnit('${id}')`, 'outline', 'plus')}</div>` : ''}</div>
      <div>
        <article class="lesson-content">
          <div class="lesson-meta"><span class="eyebrow">${t('UNIT','单元')} ${selected + 1} / ${count}</span>
            ${editor ? `<span class="badge ${unit.published ? 'green' : 'orange'}">${unit.published ? t('Published','已发布') : t('Draft','草稿')}</span>` : ''}</div>
          <h3>${esc(visible ? unitTitle(unit, selected) : t('Unit ' + (selected + 1), '第 ' + (selected + 1) + ' 单元'))}</h3>
          <p class="lesson-copy">${visible && hasBody ? esc(unitText(unit.body)) : t('The instructor has not published materials for this unit yet.','教师尚未发布本单元的学习资料。')}</p>
          <div class="lesson-controls">${editAction}${previewQuiz}</div>
        </article>
        <div class="lesson-learner">${learnerActions}</div>
      </div>
    </div>`, true);
}

function enroll(id) {
  const c = course(id);
  if (db.role !== 'student' || !c || c.draft) return;
  if (!db.enrolled.includes(id)) db.enrolled.push(id);
  save();
  render();
  openCourse(id);
  toast('You are enrolled. Happy learning!', '选课成功，开始学习吧！');
}

function completeLesson(id, index) {
  const c = course(id);
  if (db.role !== 'student' || !canStudyCourse(c) || !getUnit(c, index).published) return;
  const key = learningProgressKey(c);
  const completed = db.completed[key] ??= [];
  if (!completed.includes(index)) {
    completed.push(index);
    save();
    render();
  }
  openCourse(id, index);
  toast('Lesson marked complete', '已标记为完成');
}

function saveNote(id, index, value) {
  const c = course(id);
  if (db.role !== 'student' || !canStudyCourse(c) || !getUnit(c, index).published) return;
  db.notes ??= {};
  db.notes[learningProgressKey(c) + '-' + index] = value.slice(0, 4000);
  save();
}

function addUnit(id) {
  const c = course(id);
  if (!canEditLessons() || !c || unitCount(c) >= 30) return;
  const index = unitCount(c);
  db.unitCounts ??= {};
  db.unitCounts[id] = index + 1;
  save();
  render();
  editUnit(id, index);
}

function editUnit(id, index) {
  const c = course(id);
  if (!canEditLessons() || !c || !Number.isInteger(index) || index < 0 || index >= unitCount(c)) return;
  const unit = getUnit(c, index);
  const fields = [
    ['title', t('Lesson title','课时名称'), unit.title, 120],
    ['body', t('Lesson notes','教学内容'), unit.body, 4000],
    ['question', t('Quiz question','测验题目'), unit.quiz?.question, 450],
    ...Array.from({length: 3}, (_, i) => ['option' + i, t('Option ','选项 ') + (i + 1), unit.quiz?.options[i], 250]),
    ['explanation', t('Answer explanation','答案解析'), unit.quiz?.explanation, 800],
  ];
  const bilingualFields = ([name, label, values = ['', ''], limit]) => `<div class="lesson-editor-pair">${['en','zh'].map((language, i) => {
    const control = name === 'body'
      ? `<textarea id="unit-${name}-${language}" name="${name}-${language}" rows="5" maxlength="${limit}">${esc(values[i])}</textarea>`
      : `<input id="unit-${name}-${language}" name="${name}-${language}" maxlength="${limit}" value="${esc(values[i])}">`;
    return `<div class="field"><label for="unit-${name}-${language}">${label} · ${i === 0 ? 'English' : '中文'}</label>${control}</div>`;
  }).join('')}</div>`;
  modal(t('Edit lesson','编辑课时'), `${esc(txt(c.title))} · ${t('Unit','单元')} ${index + 1}`, `
    <form class="lesson-editor" onsubmit="saveUnit(event,'${id}',${index})">
      ${fields.slice(0, 2).map(bilingualFields).join('')}
      <details class="lesson-quiz-fields" ${unit.quiz ? 'open' : ''}>
        <summary>${t('Lesson quiz (optional)','课时测验（可选）')}</summary>
        ${fields.slice(2).map(bilingualFields).join('')}
        <div class="field"><label for="unit-answer">${t('Correct answer','正确选项')}</label>
          <select id="unit-answer" name="answer">
            <option value="">${t('Select an option','请选择')}</option>
            ${[0,1,2].map(i => `<option value="${i}" ${unit.quiz?.answer === i ? 'selected' : ''}>${t('Option ','选项 ')}${i + 1}</option>`).join('')}
          </select></div>
      </details>
      <p class="muted">${t('One language is enough to publish. Saving as draft hides this unit from students.','填写一种语言即可发布。保存为草稿后，学生无法查看此单元的内容。')}</p>
      <p class="auth-error" role="alert" id="lesson-error" hidden></p>
      <div class="modal-actions">
        ${btn(t('Cancel','取消'), `openCourse('${id}',${index})`, 'outline')}
        <button class="btn outline" type="submit" name="action" value="draft">${t('Save as draft','保存为草稿')}</button>
        <button class="btn primary" type="submit" name="action" value="publish">${unit.published ? t('Save and publish','保存并发布') : t('Publish lesson','发布课时')}</button>
      </div>
    </form>`, true);
}

function saveUnit(event, id, index) {
  event.preventDefault();
  const c = course(id);
  if (!canEditLessons() || !c || !Number.isInteger(index) || index < 0 || index >= unitCount(c)) return;
  const data = new FormData(event.currentTarget);
  const pair = (name, limit) => ['en','zh'].map(lang => String(data.get(name + '-' + lang) || '').trim().slice(0, limit));
  const published = event.submitter?.value === 'publish';
  const title = pair('title', 120);
  const body = pair('body', 4000);
  const question = pair('question', 450);
  const options = [0,1,2].map(i => pair('option' + i, 250));
  const explanation = pair('explanation', 800);
  const answer = data.get('answer');
  const hasQuiz = question.some(Boolean) || options.some(option => option.some(Boolean)) || explanation.some(Boolean) || ['0','1','2'].includes(answer);
  const error = event.currentTarget.querySelector('#lesson-error');
  function showError(en, zh) {
    error.textContent = t(en, zh);
    error.hidden = false;
    error.scrollIntoView({block: 'nearest'});
  }
  if (published && (!title.some(Boolean) || !body.some(Boolean))) {
    showError('Add a title and notes before publishing.', '发布前请填写课时名称和教学内容。');
    return;
  }
  const quiz = hasQuiz ? {question, options, answer: ['0','1','2'].includes(answer) ? Number(answer) : null, explanation} : null;
  if (published && quiz && !validUnitQuiz(quiz)) {
    showError('Complete the quiz question, all three options and the correct answer, or clear the quiz.', '请填写题目、三个选项和正确答案，或清空测验。');
    return;
  }
  const edits = db.unitEdits ??= {};
  const key = unitKey(c, index);
  const prior = edits[key];
  edits[key] = {title, body, quiz, published};
  try {
    save();
  } catch {
    if (prior) edits[key] = prior;
    else delete edits[key];
    showError('The browser could not save this lesson.', '浏览器无法保存此课时。');
    return;
  }
  render();
  openCourse(id, index);
  toast(published ? 'Lesson published' : 'Draft saved', published ? '课时已发布' : '草稿已保存');
}

function validUnitQuiz(quiz) {
  return quiz?.question.some(Boolean) && quiz.options.every(option => option.some(Boolean)) &&
    Number.isInteger(quiz.answer) && quiz.answer >= 0 && quiz.answer < quiz.options.length;
}

function quizResultKey(c, index) {
  return db.activeRosterKey + ':' + unitKey(c, index);
}

function examsPage() {
  const quizCourses = db.courses.filter(c => canStudyCourse(c) && !c.draft &&
    publishedIndices(c).some(i => validUnitQuiz(getUnit(c, i).quiz)));
  if (!quizCourses.some(c => c.id === quizCourseFilter)) quizCourseFilter = '';
  const list = quizCourses.filter(c => !quizCourseFilter || c.id === quizCourseFilter);
  return heading(t('Lesson quizzes','课时测验'), t('Choose a course and practice one unit at a time.','选择课程，按单元进行练习。')) + `
    <div class="toolbar"><select aria-label="${t('Filter by course','按课程筛选')}" onchange="quizCourseFilter=this.value;render()">
      <option value="">${t('All courses','全部课程')}</option>
      ${quizCourses.map(c => `<option value="${c.id}" ${quizCourseFilter === c.id ? 'selected' : ''}>${esc(txt(c.title))}</option>`).join('')}
    </select></div>
    ${list.map(c => `<section class="panel wide-panel lesson-exam-group"><h2>${esc(txt(c.title))}</h2>
      ${publishedIndices(c).filter(i => validUnitQuiz(getUnit(c, i).quiz)).map(i => {
        const unit = getUnit(c, i);
        const result = db.unitQuizResults?.[quizResultKey(c, i)];
        const done = result?.version === JSON.stringify(unit.quiz);
        return `<div class="lesson-exam-row"><div><small>${t('Unit','单元')} ${i + 1}</small><strong>${esc(unitTitle(unit, i))}</strong></div>
          <div>${done ? `<span class="badge ${result.correct ? 'green' : 'orange'}">${result.correct ? '1 / 1' : '0 / 1'}</span>` : ''}
            ${btn(done ? t('Try again','再试一次') : t('Start quiz','开始测验'), `openUnitQuiz('${c.id}',${i})`, 'outline', 'clipboard')}</div></div>`;
      }).join('')}</section>`).join('') || emptyState(t('No quizzes yet','暂无测验'), t('Published quizzes will appear here.','已发布的测验将在此显示。'))}`;
}

function openUnitQuiz(id, index) {
  const c = course(id);
  if (!canStudyCourse(c)) return;
  const unit = getUnit(c, index);
  if ((!unit.published && !canEditLessons()) || !validUnitQuiz(unit.quiz)) return;
  const {quiz} = unit;
  modal(t('Lesson quiz','课时测验'), esc(unitTitle(unit, index)), `
    <form onsubmit="submitUnitQuiz(event,'${id}',${index})">
      <fieldset class="unit-quiz-question">
        <legend>${esc(unitText(quiz.question))}</legend>
        ${quiz.options.map((option, i) => `<label class="quiz-option"><input type="radio" name="answer" value="${i}" required> ${esc(unitText(option))}</label>`).join('')}
      </fieldset>
      <div class="modal-actions"><button class="btn primary" type="submit">${t('Check answer','检查答案')}</button></div>
    </form>`);
}

function submitUnitQuiz(event, id, index) {
  event.preventDefault();
  const c = course(id);
  if (!canStudyCourse(c)) return;
  const unit = getUnit(c, index);
  const {quiz} = unit;
  if ((!unit.published && !canEditLessons()) || !validUnitQuiz(quiz)) return;
  const answer = new FormData(event.currentTarget).get('answer');
  if (!['0','1','2'].includes(answer)) return;
  const correct = Number(answer) === quiz.answer;
  if (db.role === 'student') {
    db.unitQuizResults ??= {};
    db.unitQuizResults[quizResultKey(c, index)] = {correct, version: JSON.stringify(quiz)};
    save();
    render();
  }
  modal(correct ? t('Correct · 1 / 1','回答正确 · 1 / 1') : t('Keep practicing · 0 / 1','继续练习 · 0 / 1'), esc(unitTitle(unit, index)), `
    <div class="lesson-content"><strong>${t('Correct answer','正确答案')}</strong>
      <p>${esc(unitText(quiz.options[quiz.answer]))}</p>
      <p>${esc(unitText(quiz.explanation))}</p></div>
    <div class="modal-actions">
      ${btn(t('Back to lesson','返回课时'), `openCourse('${id}',${index})`, 'outline')}
      ${btn(t('Try again','再试一次'), `openUnitQuiz('${id}',${index})`, 'primary')}
    </div>`);
}
