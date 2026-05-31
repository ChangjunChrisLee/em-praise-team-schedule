import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Users, AlertTriangle, RotateCcw, ClipboardCopy, Plus, RefreshCw, Save } from "lucide-react";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";

const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby2p0Ajxk2WMEzfa0wGHC5JzxN9ny4n_npjJisxur5MUHzqBon7YZpngj2INhXhcvo/exec";
const LOCAL_STORAGE_KEY = "em-praise-team-schedule-v2";

const ROLE_LIMITS = {
  "리드보컬": 2,
  "보컬": 10,
  "키보드": 2,
  "기타": 2,
  "베이스": 2,
  "드럼": 2,
  "미디어/모듈레이터": 2,
};

const INITIAL_PEOPLE = [
  "권기덕", "김주영", "김홍섭", "남유민", "단예결", "문소원", "문희은", "박증혜", "박철우",
  "서준규", "이성훈", "이영애", "이창준", "이후림", "장희진", "조윤정", "최규호", "최혜윤", "홍유선",
].sort((a, b) => a.localeCompare(b, "ko"));

const ROLE_ORDER = Object.keys(ROLE_LIMITS);
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function getSundays(year, month) {
  const out = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 0) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function makeEmptyAssignments(sundays) {
  const base = {};
  sundays.forEach((date) => {
    base[dateKey(date)] = {};
    ROLE_ORDER.forEach((role) => { base[dateKey(date)][role] = []; });
  });
  return base;
}
function mergeWithEmptyAssignments(assignments, sundays) {
  const empty = makeEmptyAssignments(sundays);
  Object.keys(empty).forEach((key) => {
    if (assignments?.[key]) {
      ROLE_ORDER.forEach((role) => { empty[key][role] = assignments[key][role] || []; });
    }
  });
  return empty;
}
function countAssignments(assignments, name) {
  let count = 0;
  Object.values(assignments).forEach((day) => Object.values(day).forEach((names) => { if (names.includes(name)) count += 1; }));
  return count;
}
function countAssignmentsByRole(assignments, name) {
  const counts = {};
  ROLE_ORDER.forEach((role) => { counts[role] = 0; });
  Object.values(assignments).forEach((day) => ROLE_ORDER.forEach((role) => { if ((day[role] || []).includes(name)) counts[role] += 1; }));
  return counts;
}
function buildShareText(sundays, assignments) {
  return sundays.map((date) => {
    const key = dateKey(date);
    const title = `${date.getMonth() + 1}/${date.getDate()}(${DAYS[date.getDay()]})`;
    const lines = [title];
    ROLE_ORDER.forEach((role) => {
      const names = assignments[key]?.[role] || [];
      lines.push(`${role}: ${names.length ? names.join(", ") : "미정"}`);
    });
    return lines.join("\n");
  }).join("\n\n");
}
function loadLocalData() {
  try { const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveLocalData(data) {
  try { window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data)); } catch {}
}
function jsonpRequest(params) {
  if (!GOOGLE_APPS_SCRIPT_URL) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const callbackName = `jsonpCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const query = new URLSearchParams({ ...params, callback: callbackName, t: String(Date.now()) });
    const script = document.createElement("script");
    script.src = `${GOOGLE_APPS_SCRIPT_URL}?${query.toString()}`;
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    window[callbackName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Google Sheet request failed")); };
    document.body.appendChild(script);
  });
}
async function loadRemoteData() { return jsonpRequest({ action: "load" }); }
async function saveRemoteData(data) { return jsonpRequest({ action: "save", data: JSON.stringify(data) }); }

export default function App() {
  const today = new Date();
  const savedData = useMemo(() => loadLocalData(), []);
  const initialYear = savedData?.year || today.getFullYear();
  const initialMonth = savedData?.month || today.getMonth() + 1;
  const initialPeople = savedData?.people?.length ? savedData.people.sort((a, b) => a.localeCompare(b, "ko")) : INITIAL_PEOPLE;

  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const sundays = useMemo(() => getSundays(year, month), [year, month]);
  const [assignments, setAssignments] = useState(() => savedData?.assignments || makeEmptyAssignments(getSundays(initialYear, initialMonth)));
  const [people, setPeople] = useState(initialPeople);
  const [selectedName, setSelectedName] = useState(savedData?.selectedName || initialPeople[0]);
  const [newMemberName, setNewMemberName] = useState("");
  const [message, setMessage] = useState(savedData ? "저장된 스케줄을 불러왔습니다." : "");
  const [lastSavedAt, setLastSavedAt] = useState(savedData?.savedAt || null);
  const [syncStatus, setSyncStatus] = useState(GOOGLE_APPS_SCRIPT_URL ? "Google Sheet 연결 준비" : "이 브라우저에만 저장 중");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const skipNextSave = useRef(false);

  const normalizedAssignments = useMemo(() => mergeWithEmptyAssignments(assignments, sundays), [assignments, sundays]);
  const appData = useMemo(() => ({ year, month, people, assignments: normalizedAssignments, selectedName }), [year, month, people, normalizedAssignments, selectedName]);

  const applyLoadedData = (data) => {
    if (!data) return;
    skipNextSave.current = true;
    const loadedYear = data.year || today.getFullYear();
    const loadedMonth = data.month || today.getMonth() + 1;
    const loadedPeople = data.people?.length ? data.people.sort((a, b) => a.localeCompare(b, "ko")) : INITIAL_PEOPLE;
    setYear(loadedYear); setMonth(loadedMonth); setPeople(loadedPeople);
    setSelectedName(data.selectedName || loadedPeople[0]);
    setAssignments(data.assignments || makeEmptyAssignments(getSundays(loadedYear, loadedMonth)));
    setLastSavedAt(data.savedAt || null);
  };

  const refreshFromSheet = async () => {
    try {
      setSyncStatus("Google Sheet에서 불러오는 중...");
      const data = await loadRemoteData();
      applyLoadedData(data);
      setSyncStatus("Google Sheet와 연결됨");
      setHasUnsavedChanges(false);
      setMessage("Google Sheet의 최신 내용을 불러왔습니다.");
    } catch {
      setSyncStatus("Google Sheet 불러오기 실패");
      setMessage("Google Sheet에서 데이터를 불러오지 못했습니다.");
    }
  };

  useEffect(() => { refreshFromSheet(); }, []);
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const localSavedAt = new Date().toISOString();
    saveLocalData({ ...appData, savedAt: lastSavedAt || localSavedAt });
    setHasUnsavedChanges(true);
    setSyncStatus("저장되지 않은 변경사항 있음");
  }, [appData]);

  const saveToSheet = async () => {
    if (!GOOGLE_APPS_SCRIPT_URL) {
      setMessage("아직 Google Apps Script URL이 입력되지 않았습니다.");
      return;
    }

    try {
      setIsSaving(true);
      setSyncStatus("Google Sheet에 저장 중...");
      const savedAt = new Date().toISOString();
      const dataToSave = { ...appData, savedAt };
      await saveRemoteData(dataToSave);
      saveLocalData(dataToSave);
      setLastSavedAt(savedAt);
      setHasUnsavedChanges(false);
      setSyncStatus("Google Sheet에 저장됨");
      setMessage("저장되었습니다.");
    } catch {
      setSyncStatus("Google Sheet 저장 실패");
      setMessage("저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const changeMonth = (nextMonth) => {
    let y = year, m = nextMonth;
    if (m < 1) { y -= 1; m = 12; }
    if (m > 12) { y += 1; m = 1; }
    setYear(y); setMonth(m);
    setAssignments((prev) => ({ ...makeEmptyAssignments(getSundays(y, m)), ...prev }));
  };
  const toggleAssignment = (key, role) => {
    setAssignments((prev) => {
      const next = JSON.parse(JSON.stringify({ ...makeEmptyAssignments(sundays), ...prev }));
      const day = next[key];
      const current = day[role] || [];
      const alreadyInThisRole = current.includes(selectedName);
      const assignedElsewhereThatDay = ROLE_ORDER.some((r) => r !== role && (day[r] || []).includes(selectedName));
      if (alreadyInThisRole) { day[role] = current.filter((n) => n !== selectedName); setMessage(`${selectedName}님의 ${role} 배정을 취소했습니다.`); return next; }
      if (assignedElsewhereThatDay) { setMessage(`${selectedName}님은 같은 주차에 이미 다른 포지션으로 배정되어 있습니다.`); return prev; }
      if (current.length >= ROLE_LIMITS[role]) { setMessage(`${role} 포지션 정원이 이미 찼습니다.`); return prev; }
      day[role] = [...current, selectedName];
      setMessage(`${selectedName}님을 ${role}에 배정했습니다.`);
      return next;
    });
  };
  const resetAll = () => { setAssignments(makeEmptyAssignments(sundays)); setMessage("이번 달 배정을 초기화했습니다."); };
  const addMember = () => {
    const name = newMemberName.trim();
    if (!name) { setMessage("추가할 이름을 입력해주세요."); return; }
    if (people.includes(name)) { setSelectedName(name); setMessage(`${name}님은 이미 등록되어 있습니다.`); setNewMemberName(""); return; }
    setPeople((prev) => [...prev, name].sort((a, b) => a.localeCompare(b, "ko")));
    setSelectedName(name); setNewMemberName(""); setMessage(`${name}님을 새 멤버로 추가했습니다.`);
  };
  const copyText = async () => { await navigator.clipboard.writeText(buildShareText(sundays, normalizedAssignments)); setMessage("카카오톡 공유용 일정표를 복사했습니다."); };

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">EM Praise Team Schedule</h1>
            <p className="mt-3 text-base text-slate-600">① 이름 선택 → ② 가능한 날짜 선택 → ③ 원하는 포지션 선택 → ④ 저장 클릭</p>
          </div>
          <Card className="rounded-2xl border-none shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <Button variant="outline" onClick={() => changeMonth(month - 1)}>이전달</Button>
              <div className="min-w-32 text-center text-xl font-bold">{year}년 {month}월</div>
              <Button variant="outline" onClick={() => changeMonth(month + 1)}>다음달</Button>
            </CardContent>
          </Card>
        </motion.div>

        <div className="space-y-4">
          <Card className="rounded-2xl border-none shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold"><Users size={18} /> 이름 선택</div>
                <div className="text-sm text-slate-500">선택됨: <span className="font-bold text-slate-900">{selectedName}</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {people.map((person) => {
                  const active = selectedName === person;
                  return <button key={person} onClick={() => { setSelectedName(person); setMessage(`${person}님을 선택했습니다.`); }} className={`rounded-full px-3 py-2 text-sm transition ${active ? "bg-slate-900 text-white shadow" : "bg-white text-slate-700 shadow-sm hover:bg-slate-100"}`}>{person}</button>;
                })}
              </div>
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
                <input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMember(); }} placeholder="새 멤버 이름" className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400" />
                <Button variant="outline" onClick={addMember}><Plus size={16} className="mr-1" /> 추가</Button>
              </div>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {message && <div className="mr-auto rounded-xl bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">{message}</div>}
            <div className={`rounded-xl bg-white px-3 py-2 text-xs shadow-sm ${hasUnsavedChanges ? "text-amber-600" : "text-slate-500"}`}>{syncStatus}</div>
            {lastSavedAt && <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">저장됨: {new Date(lastSavedAt).toLocaleString("ko-KR")}</div>}
            <Button variant="outline" onClick={saveToSheet} disabled={isSaving || !hasUnsavedChanges}><Save size={16} className="mr-1" /> {isSaving ? "저장 중" : "저장"}</Button>
            <Button variant="outline" onClick={refreshFromSheet}><RefreshCw size={16} className="mr-1" /> 새로고침</Button>
            <Button variant="outline" onClick={copyText}><ClipboardCopy size={16} className="mr-1" /> 복사</Button>
            <Button variant="outline" onClick={resetAll}><RotateCcw size={16} className="mr-1" /> 초기화</Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {sundays.map((date) => {
            const key = dateKey(date);
            const day = normalizedAssignments[key];
            const label = `${month}/${date.getDate()}(${DAYS[date.getDay()]})`;
            return <Card key={key} className="rounded-2xl border-none shadow-sm"><CardContent className="p-4">
              <div className="mb-4 flex items-center justify-between"><div><div className="text-xl font-bold">{label}</div><div className="text-sm text-slate-500">주일예배</div></div><div className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">{Object.values(day).reduce((s, names) => s + names.length, 0)}명 배정</div></div>
              <div className="space-y-2">
                {ROLE_ORDER.map((role) => {
                  const names = day[role] || [];
                  const full = names.length >= ROLE_LIMITS[role];
                  const selectedHere = names.includes(selectedName);
                  const assignedSameDay = ROLE_ORDER.some((r) => r !== role && (day[r] || []).includes(selectedName));
                  const disabled = !selectedHere && (full || assignedSameDay);
                  return <div key={role} className="grid grid-cols-[130px_1fr_auto] items-center gap-2 rounded-xl bg-slate-50 p-2"><div className="font-medium text-slate-700">{role}</div><div className="min-h-8">{names.length ? <div className="flex flex-wrap gap-1">{names.map((name) => <span key={name} className={`rounded-full px-2 py-1 text-xs ${name === selectedName ? "bg-slate-900 text-white" : "bg-white text-slate-700 shadow-sm"}`}>{name}</span>)}</div> : <span className="text-sm text-slate-400">미정</span>}</div><Button size="sm" variant={selectedHere ? "default" : "outline"} disabled={disabled} onClick={() => toggleAssignment(key, role)}>{selectedHere ? "취소" : "들어가기"}</Button></div>;
                })}
              </div>
            </CardContent></Card>;
          })}
        </div>

        <Card className="rounded-2xl border-none shadow-sm"><CardContent className="p-4"><div className="mb-3 flex items-center gap-2 font-semibold"><AlertTriangle size={18} /> Serving Summary</div><div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
          {people.map((person) => {
            const count = countAssignments(normalizedAssignments, person);
            const roleCounts = countAssignmentsByRole(normalizedAssignments, person);
            const activeRoles = ROLE_ORDER.filter((role) => roleCounts[role] > 0);
            return <div key={person} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><div className="font-semibold">{person}</div><div className="rounded-full bg-white px-2 py-1 text-sm font-bold shadow-sm">총 {count}회</div></div><div className="mt-2 flex flex-wrap gap-1">{activeRoles.length ? activeRoles.map((role) => <span key={role} className="rounded-full bg-white px-2 py-1 text-xs text-slate-700 shadow-sm">{role} {roleCounts[role]}회</span>) : <span className="text-sm text-slate-400">아직 배정 없음</span>}</div></div>;
          })}
        </div></CardContent></Card>
      </div>
    </div>
  );
}
