// The one script this connector runs inside Apple Reminders, through
// `osascript -l JavaScript` (JXA). It is a plain string, never built by
// interpolation: every value from the model reaches it as ONE JSON argument
// (argv[0]), so no title, note or list name can ever become code.
//
// Contract: argv[0] is {"op": ..., ...}. The script always returns a JSON
// string, {"ok": true, "data": ...} or {"ok": false, "error": ..., "number": ...}.
// Dates cross the boundary as epoch milliseconds (absolute instants) or as
// [year, month, day] for an all-day date, which the script turns into local
// midnight. Time zones are therefore decided once, in dates.ts, not here.
//
// Lessons from running this against a real Reminders database (macOS 26):
// - `app.reminders.byId(...)` at the APPLICATION level walks every reminder of
//   every list and can hang for minutes. Lookups always go list by list.
// - Due date and remind-me date are one value in current Reminders: setting
//   either moves both. core.ts exposes that honestly instead of pretending.
// - A date cannot be cleared through scripting ("Can't convert types",
//   "Can't make missing value into type date"), in JXA or in AppleScript.
// - Properties are read in bulk (`list.reminders.name()` is one Apple event
//   for the whole list), never reminder by reminder.

export const JXA_SCRIPT = String.raw`
function run(argv) {
  var R = Application('Reminders');
  var a;
  try { a = JSON.parse(argv[0]); } catch (e) { return JSON.stringify({ ok: false, error: 'bad request' }); }

  function iso(d) { return d ? d.toISOString() : null; }
  function day(p) { return new Date(p[0], p[1] - 1, p[2]); }

  function allLists() {
    var ids = R.lists.id(), names = R.lists.name(), out = [];
    for (var i = 0; i < ids.length; i++) out.push({ id: ids[i], name: names[i] });
    return out;
  }

  function findList(ref) {
    var lists = allLists(), hit = [];
    for (var i = 0; i < lists.length; i++) if (lists[i].id === ref) return R.lists.byId(lists[i].id);
    for (var j = 0; j < lists.length; j++) if (lists[j].name === ref) hit.push(lists[j]);
    if (hit.length === 0) {
      var low = String(ref).toLowerCase();
      for (var k = 0; k < lists.length; k++) if (lists[k].name.toLowerCase() === low) hit.push(lists[k]);
    }
    if (hit.length === 1) return R.lists.byId(hit[0].id);
    if (hit.length > 1) throw { code: 'AMBIGUOUS_LIST', message: 'More than one list is called "' + ref + '": use its id instead (' + hit.map(function (h) { return h.id; }).join(', ') + ').' };
    throw { code: 'NO_LIST', message: 'No list called "' + ref + '". Call list_lists to see the lists that exist.' };
  }

  function snapshot(r, list) {
    return {
      id: r.id(), name: r.name(), body: r.body(), completed: r.completed(),
      completionDate: iso(r.completionDate()), dueDate: iso(r.dueDate()),
      alldayDueDate: iso(r.alldayDueDate()), remindMeDate: iso(r.remindMeDate()),
      priority: r.priority(), creationDate: iso(r.creationDate()),
      list: { id: list.id(), name: list.name() }
    };
  }

  function findReminder(id, listRef) {
    var lists = listRef ? [findList(listRef)] : R.lists();
    for (var i = 0; i < lists.length; i++) {
      var m = lists[i].reminders.whose({ id: id });
      if (m.length > 0) return { r: lists[i].reminders.byId(id), list: lists[i] };
    }
    throw { code: 'NO_REMINDER', message: 'No reminder with id ' + id + (listRef ? ' in that list' : '') + '. Call list_reminders to get current ids.' };
  }

  function applyFields(r, f) {
    if (f.name !== undefined) r.name = f.name;
    if (f.body !== undefined) r.body = f.body;
    if (f.priority !== undefined) r.priority = f.priority;
    if (f.dueMs !== undefined) r.dueDate = new Date(f.dueMs);
    if (f.dueDay !== undefined) r.alldayDueDate = day(f.dueDay);
    if (f.completed !== undefined) r.completed = f.completed;
  }

  try {
    var data;
    if (a.op === 'lists') {
      var ls = R.lists(), out = [], def = null;
      try { def = R.defaultList().id(); } catch (e) {}
      for (var i = 0; i < ls.length; i++) {
        out.push({ id: ls[i].id(), name: ls[i].name(), open: ls[i].reminders.whose({ completed: false }).length, isDefault: ls[i].id() === def });
      }
      data = out;
    } else if (a.op === 'reminders') {
      var list = findList(a.list);
      var src = a.status === 'incomplete' ? list.reminders.whose({ completed: false })
              : a.status === 'completed' ? list.reminders.whose({ completed: true })
              : list.reminders;
      var cols = {
        id: src.id(), name: src.name(), body: src.body(), completed: src.completed(),
        completionDate: src.completionDate(), dueDate: src.dueDate(), alldayDueDate: src.alldayDueDate(),
        remindMeDate: src.remindMeDate(), priority: src.priority(), creationDate: src.creationDate()
      };
      var rows = [];
      for (var n = 0; n < cols.id.length; n++) {
        rows.push({
          id: cols.id[n], name: cols.name[n], body: cols.body[n], completed: cols.completed[n],
          completionDate: iso(cols.completionDate[n]), dueDate: iso(cols.dueDate[n]),
          alldayDueDate: iso(cols.alldayDueDate[n]), remindMeDate: iso(cols.remindMeDate[n]),
          priority: cols.priority[n], creationDate: iso(cols.creationDate[n])
        });
      }
      data = { list: { id: list.id(), name: list.name() }, reminders: rows };
    } else if (a.op === 'create') {
      var target = a.list ? findList(a.list) : R.defaultList();
      var props = { name: a.fields.name };
      var made = R.Reminder(props);
      target.reminders.push(made);
      var fresh = target.reminders.byId(made.id());
      var rest = {};
      for (var key in a.fields) if (key !== 'name') rest[key] = a.fields[key];
      applyFields(fresh, rest);
      data = snapshot(fresh, target);
    } else if (a.op === 'update') {
      var found = findReminder(a.id, a.list);
      applyFields(found.r, a.fields);
      data = snapshot(found.r, found.list);
    } else {
      return JSON.stringify({ ok: false, error: 'unknown op' });
    }
    return JSON.stringify({ ok: true, data: data });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e), number: e && e.errorNumber, code: e && e.code });
  }
}
`;
