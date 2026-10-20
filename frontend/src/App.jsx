import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const STORAGE_KEY = 'fixforward.cases.v1';
const CURRENT_CASE_KEY = 'fixforward.currentCase.v1';

// FixForward currently specializes in one demo appliance: the WhirlNest WashPro 8kg.
const fallbackAppliances = [
  { appliance_id: 'APL-1001', brand: 'WhirlNest', model: 'WashPro 8kg', appliance_type: 'washing_machine', location_label: 'Home · Utility area', warranty_status: 'active', warranty_expiry: datePlus(65), purchase_date: dateMinus(300) },
];

function datePlus(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function dateMinus(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function makeDemoSlots() {
  const config = [[1, 10], [1, 14], [2, 9], [2, 13], [3, 11], [3, 15]];
  return config.map(([day, hour], i) => {
    const start = new Date(); start.setDate(start.getDate() + day); start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60 * 1000);
    return { slot_id: `LOCAL-${String(i + 1).padStart(3, '0')}`, service_type: 'washing_machine_repair', starts_at: start.toISOString(), ends_at: end.toISOString(), technician_name: ['Maya R.', 'Arjun K.', 'Riya S.', 'Kabir P.'][i % 4], status: 'available' };
  });
}
function readCases() { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(saved) ? saved.filter((item) => item?.appliance_id === 'APL-1001' && (item?.appliance_type === undefined || item?.appliance_type === 'washing_machine')) : []; } catch { return []; } }
function saveCases(cases) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cases)); }
function formatDate(value, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', options).format(date);
}
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}
function relativeDay(value) {
  if (!value) return 'To be decided';
  const date = new Date(value); const today = new Date();
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const delta = Math.round((a - b) / 86400000);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  return formatDate(value, { weekday: 'short', month: 'short', day: 'numeric' });
}
function applianceLabel() { return 'Washing machine'; }
function applianceIcon() { return 'washer'; }
function caseStatusLabel(status) {
  return ({ reported: 'Case opened', scheduled: 'Visit scheduled', needs_rescheduling: 'Needs a new time', resolved: 'Resolved', closed: 'Closed' })[status] || 'In progress';
}
function isOpenCase(item) { return !['resolved', 'closed'].includes(item?.status); }
function freshTimeline() {
  return [{ title: 'Issue captured', detail: 'Tell us what changed. We will take it from there.', tone: 'done', time: 'Just now' }];
}
function normalizeCase(raw, appliance) {
  const source = raw?.case || raw || {};
  return {
    ...source,
    case_id: source.case_id || raw.case_id,
    appliance_id: source.appliance_id || raw.appliance_id || appliance?.appliance_id,
    brand: source.brand || appliance?.brand || 'WhirlNest',
    model: source.model || appliance?.model || 'WashPro 8kg',
    appliance_type: source.appliance_type || appliance?.appliance_type || 'washing_machine',
    issue_description: source.issue_description || raw.issue_description || 'Appliance needs inspection',
    status: source.status || raw.status || 'reported',
    warranty_status: source.warranty_status || raw.warranty_status || appliance?.warranty_status || 'unknown',
    timeline: source.timeline || freshTimeline(),
    created_at: source.created_at || new Date().toISOString(),
  };
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || payload.message || `Request failed (${response.status})`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function BrandMark({ small = false }) {
  return <div className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true"><span /><span /><span /><span /></div>;
}

function ApplianceArt() {
  return <svg viewBox="0 0 150 160" className="appliance-art" aria-hidden="true"><rect x="24" y="9" width="102" height="142" rx="13" fill="#f8f5eb" stroke="#27364d" strokeWidth="2.5"/><path d="M24 42h102" stroke="#27364d" strokeWidth="2.5"/><circle cx="42" cy="25" r="3.4" fill="#ee805f"/><circle cx="53" cy="25" r="3.4" fill="#c4cf55"/><circle cx="64" cy="25" r="3.4" fill="#9bb8eb"/><circle cx="75" cy="94" r="35" fill="#dce8e0" stroke="#27364d" strokeWidth="2.5"/><circle cx="75" cy="94" r="25" fill="#b6cfc7" stroke="#5c7f78" strokeWidth="1.5"/><path d="M57 92c6-17 26-15 34 0-8 14-28 15-34 0Z" fill="#8eb3a9"/><path d="M56 108c11-10 28-9 38 1" stroke="#fffaf0" strokeWidth="3" fill="none" strokeLinecap="round"/></svg>;
}

function SectionTitle({ eyebrow, title, action, onAction }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <button className="text-action" onClick={onAction}>{action}<Icon name="arrow" size={15} /></button>}</div>;
}

function StatusPill({ status }) {
  const cls = status === 'scheduled' ? 'green' : status === 'needs_rescheduling' ? 'coral' : status === 'resolved' || status === 'closed' ? 'muted' : 'blue';
  return <span className={`status-pill ${cls}`}><span className="status-dot" />{caseStatusLabel(status)}</span>;
}

function Modal({ title, description, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button><div className="modal-heading"><span className="eyebrow">FIXFORWARD WORKSPACE</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</section></div>;
}

export default function App() {
  const [appliances, setAppliances] = useState(fallbackAppliances);
  const [slots, setSlots] = useState(makeDemoSlots());
  const [cases, setCases] = useState(() => readCases());
  const [currentCaseId, setCurrentCaseId] = useState(() => localStorage.getItem(CURRENT_CASE_KEY) || '');
  const [connected, setConnected] = useState(false);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('Overview');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [showApplianceModal, setShowApplianceModal] = useState(false);
  const [selectedApplianceId, setSelectedApplianceId] = useState('APL-1001');
  const [issue, setIssue] = useState('Excessive vibration and unusual noise during the spin cycle.');
  const [pendingSlot, setPendingSlot] = useState(null);
  const [pendingCaseId, setPendingCaseId] = useState('');
  const [creatingCase, setCreatingCase] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi there. I’m your WashPro 8kg repair concierge — from safe first checks to finding a technician and recovering a cancelled visit.', stamp: 'FIXFORWARD GUIDE' },
    { role: 'assistant', text: 'Try asking “check my washer warranty”, “what should I do about vibration?”, or “find me a repair appointment”.', stamp: 'READY WHEN YOU ARE' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  const currentCase = useMemo(() => cases.find((item) => item.case_id === currentCaseId) || cases[0] || null, [cases, currentCaseId]);
  const selectedAppliance = useMemo(() => appliances.find((item) => item.appliance_id === selectedApplianceId) || appliances[0], [appliances, selectedApplianceId]);
  const openCases = cases.filter(isOpenCase).length;
  const scheduledCount = cases.filter((item) => item.status === 'scheduled').length;
  const activeWarrantyCount = appliances.filter((item) => item.warranty_status === 'active').length;

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const persistCases = useCallback((next) => {
    setCases(next);
    saveCases(next);
  }, []);

  const updateCase = useCallback((caseId, updater) => {
    setCases((previous) => {
      const next = previous.map((item) => item.case_id === caseId ? (typeof updater === 'function' ? updater(item) : { ...item, ...updater }) : item);
      saveCases(next);
      return next;
    });
  }, []);

  const refreshSlots = useCallback(async () => {
    if (connected) {
      try {
        const response = await apiRequest('/api/slots?limit=12');
        setSlots(response.slots || []);
        return response.slots || [];
      } catch {
        setSlots(makeDemoSlots());
        setConnected(false);
        return makeDemoSlots();
      }
    }
    const currentLocalSlots = makeDemoSlots();
    setSlots(currentLocalSlots);
    return currentLocalSlots;
  }, [connected]);

  const refreshCase = useCallback(async (caseId) => {
    if (!caseId) return null;
    if (connected) {
      try {
        const response = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}`);
        const existing = cases.find((item) => item.case_id === caseId);
        const appliance = appliances.find((item) => item.appliance_id === response.case?.appliance_id);
        const normalized = normalizeCase({ ...response.case, timeline: existing?.timeline || freshTimeline() }, appliance);
        setCases((prev) => {
          const next = prev.some((item) => item.case_id === caseId) ? prev.map((item) => item.case_id === caseId ? { ...item, ...normalized } : item) : [normalized, ...prev];
          saveCases(next);
          return next;
        });
        return normalized;
      } catch { return null; }
    }
    return cases.find((item) => item.case_id === caseId) || null;
  }, [connected, cases, appliances]);

  useEffect(() => {
    let live = true;
    async function boot() {
      setLoading(true);
      try {
        const health = await apiRequest('/health');
        const [applianceResult, slotResult] = await Promise.all([
          apiRequest('/api/appliances'),
          apiRequest('/api/slots?limit=12'),
        ]);
        if (!live) return;
        setConnected(true);
        // Drop browser-only cases when reconnecting to the API; they do not exist in its database.
        setCases((previous) => { const next = previous.filter((item) => !String(item.case_id).startsWith('LOCAL-FF-') && item.appliance_id === 'APL-1001'); saveCases(next); return next; });
        setAppliances(applianceResult);
        setSlots(slotResult.slots || []);
        setConnectionChecked(true);
        if (!applianceResult.some((item) => item.appliance_id === selectedApplianceId) && applianceResult[0]) setSelectedApplianceId(applianceResult[0].appliance_id);
        setMessages((previous) => [{ role: 'assistant', text: 'I’m connected to the WashPro 8kg repair workflow. I can check its demo warranty, retrieve safety-first troubleshooting steps, open a repair case, and arrange a demo appointment after your confirmation.', stamp: 'WORKFLOW CONNECTED' }, ...previous.slice(-1)]);
      } catch {
        if (!live) return;
        setConnected(false);
        setAppliances(fallbackAppliances);
        setSlots(makeDemoSlots());
        setConnectionChecked(true);
      } finally {
        if (live) setLoading(false);
      }
    }
    boot();
    return () => { live = false; };
    // Boot only once; the selected appliance preference is applied separately when needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { saveCases(cases); }, [cases]);
  useEffect(() => { if (currentCaseId) localStorage.setItem(CURRENT_CASE_KEY, currentCaseId); }, [currentCaseId]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages]);

  const addTimeline = useCallback((caseId, title, detail, tone = 'done') => {
    updateCase(caseId, (item) => ({ ...item, timeline: [{ title, detail, tone, time: 'Just now' }, ...(item.timeline || [])].slice(0, 5) }));
  }, [updateCase]);

  const createRepairCase = useCallback(async (applianceId, description) => {
    const appliance = appliances.find((item) => item.appliance_id === applianceId) || fallbackAppliances[0];
    if (!description.trim() || description.trim().length < 8) throw new Error('Add a little more detail so the repair team knows what to look for.');
    let normalized;
    if (connected) {
      const result = await apiRequest('/api/cases', { method: 'POST', body: JSON.stringify({ appliance_id: applianceId, issue_description: description.trim() }) });
      normalized = normalizeCase(result, appliance);
      try {
        const full = await apiRequest(`/api/cases/${encodeURIComponent(result.case_id)}`);
        normalized = normalizeCase({ ...full.case, timeline: freshTimeline() }, appliance);
      } catch { /* the created case still has enough information to show */ }
    } else {
      normalized = normalizeCase({
        case_id: `LOCAL-FF-${Math.random().toString(16).slice(2, 8).toUpperCase()}`, 
        appliance_id: applianceId,
        issue_description: description.trim(),
        status: 'reported',
        warranty_status: appliance.warranty_status,
        created_at: new Date().toISOString(),
        timeline: freshTimeline(),
      }, appliance);
    }
    setCases((previous) => {
      const next = [normalized, ...previous.filter((item) => item.case_id !== normalized.case_id)];
      saveCases(next);
      return next;
    });
    setCurrentCaseId(normalized.case_id);
    return normalized;
  }, [appliances, connected]);

  const startRecoveryDemo = async () => {
    setBusyAction('demo');
    try {
      const newCase = await createRepairCase('APL-1001', 'Excessive vibration and unusual noise during the spin cycle.');
      notify(`Repair case ${newCase.case_id} is open. Next, choose a visit time.`);
      setMessages((previous) => [...previous, { role: 'assistant', text: `I’ve opened case ${newCase.case_id} for the WashPro 8kg. No appointment has been booked yet. Let’s choose a time together.`, stamp: 'CASE CREATED' }]);
      await refreshSlots();
      setPendingCaseId(newCase.case_id);
      setShowSlotModal(true);
    } catch (error) {
      notify(error.message || 'Could not start the walkthrough.', 'error');
    } finally { setBusyAction(''); }
  };

  const submitNewCase = async (event) => {
    event.preventDefault();
    setCreatingCase(true);
    try {
      const newCase = await createRepairCase(selectedApplianceId, issue);
      setShowCaseModal(false);
      notify(`Case ${newCase.case_id} created.`);
      addTimeline(newCase.case_id, 'Repair case opened', 'Your issue has been saved. No appointment has been booked.', 'done');
      setIssue('');
      setMessages((previous) => [...previous, { role: 'assistant', text: `Case ${newCase.case_id} is ready. I’ve saved the issue and checked the next step. Would you like to review safe troubleshooting checks or look for a technician?`, stamp: 'CASE CREATED' }]);
    } catch (error) { notify(error.message || 'Could not create the case.', 'error'); }
    finally { setCreatingCase(false); }
  };

  const chooseSlot = (slot, caseId = currentCase?.case_id) => {
    if (!caseId) { notify('Open a repair case before booking an appointment.', 'error'); return; }
    setPendingCaseId(caseId);
    setPendingSlot(slot);
  };

  const confirmBooking = async () => {
    if (!pendingSlot || !pendingCaseId) return;
    setBusyAction('booking');
    const oldCase = cases.find((item) => item.case_id === pendingCaseId);
    const isReschedule = oldCase?.status === 'needs_rescheduling';
    try {
      let response;
      if (connected) {
        const path = isReschedule ? `/api/cases/${encodeURIComponent(pendingCaseId)}/reschedule` : `/api/cases/${encodeURIComponent(pendingCaseId)}/book`;
        response = await apiRequest(path, { method: 'POST', body: JSON.stringify({ slot_id: pendingSlot.slot_id, user_confirmed: true }) });
        if (!response.ok) throw new Error(response.message || response.error || 'That slot could not be booked. Refresh availability and choose another.');
      } else {
        response = { ok: true, status: 'scheduled', slot: pendingSlot };
      }
      const slot = response.slot || pendingSlot;
      updateCase(pendingCaseId, (item) => ({
        ...item,
        status: 'scheduled',
        current_slot_id: slot.slot_id,
        slot_id: slot.slot_id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        technician_name: slot.technician_name,
        cancellation_reason: null,
        timeline: [{ title: isReschedule ? 'Replacement visit confirmed' : 'Appointment confirmed', detail: `${formatDate(slot.starts_at)} · ${formatTime(slot.starts_at)} with ${slot.technician_name}`, tone: 'done', time: 'Just now' }, ...(item.timeline || [])].slice(0, 5),
      }));
      setCurrentCaseId(pendingCaseId);
      setPendingSlot(null); setPendingCaseId(''); setShowSlotModal(false);
      if (connected) await refreshSlots();
      else setSlots((previous) => previous.map((item) => item.slot_id === pendingSlot.slot_id ? { ...item, status: 'booked' } : item));
      notify(isReschedule ? 'A new appointment is confirmed.' : 'Appointment confirmed. Your case is on track.');
      setMessages((previous) => [...previous, { role: 'assistant', text: `${isReschedule ? 'New appointment confirmed' : 'You’re booked'} for ${formatDate(slot.starts_at)} at ${formatTime(slot.starts_at)} with ${slot.technician_name}. This is a demo booking saved to ${connected ? 'the connected repair database' : 'this browser session'}.`, stamp: 'APPOINTMENT CONFIRMED' }]);
    } catch (error) { notify(error.message || 'Could not confirm the appointment.', 'error'); }
    finally { setBusyAction(''); }
  };

  const simulateCancellation = async () => {
    if (!currentCase) return;
    setBusyAction('cancel');
    try {
      if (connected) await apiRequest(`/api/cases/${encodeURIComponent(currentCase.case_id)}/simulate-cancellation`, { method: 'POST' });
      updateCase(currentCase.case_id, (item) => ({
        ...item,
        status: 'needs_rescheduling',
        cancellation_reason: 'Technician unavailable (simulated demo event)',
        timeline: [{ title: 'Technician cancelled', detail: 'The original visit was cancelled in the demo system. Your repair case stays open.', tone: 'warning', time: 'Just now' }, ...(item.timeline || [])].slice(0, 5),
      }));
      if (connected) await refreshSlots();
      else setSlots((previous) => previous.map((item) => item.slot_id === currentCase.current_slot_id ? { ...item, status: 'cancelled' } : item));
      notify('Cancellation detected. The repair case is still open.', 'success');
      setMessages((previous) => [...previous, { role: 'assistant', text: 'The technician cancelled in our demo scenario. I kept the same repair case open and pulled fresh availability. Pick a replacement slot; I’ll ask you to confirm before changing the booking.', stamp: 'RECOVERY WORKFLOW' }]);
      setPendingCaseId(currentCase.case_id);
      setShowSlotModal(true);
    } catch (error) { notify(error.message || 'Could not simulate a cancellation.', 'error'); }
    finally { setBusyAction(''); }
  };

  const getTroubleshooting = async (applianceId, symptoms) => {
    const appliance = appliances.find((item) => item.appliance_id === applianceId) || selectedAppliance;
    if (connected) {
      const result = await apiRequest(`/api/appliances/${encodeURIComponent(applianceId)}/troubleshooting?symptoms=${encodeURIComponent(symptoms || 'unusual noise')}`);
      return result;
    }
    return {
      ok: true,
      guide_title: 'WashPro 8kg safety-first checklist',
      steps: [
        'Stop the cycle if the machine shakes heavily, makes a harsh grinding noise, smells burnt, or leaks near an electrical connection.',
        'For spin-cycle vibration, pause the cycle and rebalance the laundry only after the drum has stopped.',
        'Check from the outside that the machine is level and not touching a wall or cabinet.',
        'If noise or vibration continues, stop using the machine and arrange a qualified technician inspection.',
      ],
      safety_note: 'Do not remove fixed panels or work on wiring. Disconnect power before any permitted external inspection.',
      assessment: 'These are initial user-safe checks, not a confirmed diagnosis.',
    };
  };

  const checkWarranty = async (applianceId) => {
    if (connected) return apiRequest(`/api/appliances/${encodeURIComponent(applianceId)}/warranty`);
    const appliance = appliances.find((item) => item.appliance_id === applianceId);
    return { ok: true, appliance: `${appliance?.brand || ''} ${appliance?.model || ''}`.trim(), warranty_status: appliance?.warranty_status || 'unknown', warranty_expiry: appliance?.warranty_expiry, note: 'Demo warranty record only. Confirm actual coverage with the manufacturer.' };
  };

  const sendMessage = async (event) => {
    event?.preventDefault();
    const text = chatInput.trim();
    if (!text || busyAction === 'chat') return;
    setChatInput('');
    setMessages((previous) => [...previous, { role: 'user', text }]);
    setBusyAction('chat');
    const lower = text.toLowerCase();
    try {
      if (lower.includes('warranty') || lower.includes('coverage')) {
        const match = appliances.find((item) => lower.includes(item.appliance_id.toLowerCase()) || lower.includes(item.model.toLowerCase()) || lower.includes(applianceLabel(item.appliance_type).toLowerCase()));
        const target = match || selectedAppliance;
        const result = await checkWarranty(target.appliance_id);
        const active = result.warranty_status === 'active';
        setMessages((previous) => [...previous, { role: 'assistant', text: `${result.appliance || `${target.brand} ${target.model}`}: the saved demo record says warranty is ${active ? 'active' : result.warranty_status || 'unknown'}${result.warranty_expiry ? ` through ${formatDate(result.warranty_expiry, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. ${result.note || 'Please confirm actual coverage with the manufacturer.'}`, stamp: 'WARRANTY LOOKUP' }]);
      } else if (['vibrat', 'noise', 'spin', 'drain', 'leak', 'door', "won't start", 'not starting', 'troubleshoot', 'what should i do'].some((word) => lower.includes(word))) {
        const target = selectedAppliance || fallbackAppliances[0];
        const result = await getTroubleshooting(target.appliance_id, text);
        const lines = (result.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n');
        setMessages((previous) => [...previous, { role: 'assistant', text: `${result.guide_title || 'Safety-first checks'} for ${target.brand} ${target.model}:\n${lines}\n\nSafety note: ${result.safety_note || 'Do not remove fixed panels or work on wiring.'}`, stamp: 'TROUBLESHOOTING GUIDE' }]);
      } else if (lower.includes('cancel') && currentCase?.status === 'scheduled') {
        await simulateCancellation();
      } else if (lower.includes('appointment') || lower.includes('book') || lower.includes('technician') || lower.includes('schedule') || lower.includes('reschedul')) {
        if (currentCase) {
          setPendingCaseId(currentCase.case_id);
          await refreshSlots();
          setShowSlotModal(true);
          setMessages((previous) => [...previous, { role: 'assistant', text: `I’m showing available appointment times for case ${currentCase.case_id}. Choose a slot, review the technician and time, then confirm to make the demo booking.`, stamp: 'AVAILABILITY LOOKUP' }]);
        } else {
          setMessages((previous) => [...previous, { role: 'assistant', text: 'Let’s start by opening a repair case so the appointment stays connected to the issue. Use “Start a repair” at the top of the workspace.', stamp: 'NEXT STEP' }]);
        }
      } else if (lower.includes('open') && lower.includes('case')) {
        setShowCaseModal(true);
        setMessages((previous) => [...previous, { role: 'assistant', text: 'I’ve opened the repair form. Add the appliance and the symptoms; I’ll save a case before we look at appointment options.', stamp: 'CASE SETUP' }]);
      } else {
        setMessages((previous) => [...previous, { role: 'assistant', text: 'I can run a few concrete workflows in this build: check a saved warranty, retrieve safety-first troubleshooting checks, open a repair case, look up appointment availability, or recover from a simulated technician cancellation. Which should we tackle?', stamp: 'SUPPORTED ACTIONS' }]);
      }
    } catch (error) {
      setMessages((previous) => [...previous, { role: 'assistant', text: `I couldn’t complete that lookup: ${error.message || 'the service did not respond'}. You can retry, or check the connection badge in the header.`, stamp: 'WORKFLOW NOTICE' }]);
    } finally { setBusyAction(''); }
  };

  const navItems = [
    { label: 'Overview', icon: 'grid' },
    { label: 'Repair cases', icon: 'wrench', count: openCases || null },
    { label: 'Appointments', icon: 'calendar' },
    { label: 'Washer handbook', icon: 'book' },
  ];

  const filteredCases = cases.filter((item) => `${item.case_id} ${item.issue_description} ${item.model}`.toLowerCase().includes(searchTerm.toLowerCase()));
  const canRecover = currentCase?.status === 'scheduled';

  const navigateTo = (label) => {
    setActiveView(label);
    setSidebarOpen(false);
    if (label === 'Appointments') setShowSlotModal(true);
    if (label === 'Repair cases' && !cases.length) setShowCaseModal(true);
    if (label === 'Washer handbook') setMessages((previous) => [...previous, { role: 'assistant', text: 'The WashPro handbook focuses on safe first checks for vibration, noise, drainage, and spin-cycle issues. Choose a symptom in the message box to retrieve relevant guidance.', stamp: 'WASHER HANDBOOK' }]);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><BrandMark /><div><span className="brand-name">fixforward<span className="brand-period">.</span></span><span className="brand-kicker">HOME, IN GOOD HANDS</span></div><button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><Icon name="close" /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar"><Icon name="home" size={17} /></div><div className="workspace-copy"><strong>My home</strong><span>Personal workspace</span></div><Icon name="down" size={15} className="workspace-chevron" /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => <button key={item.label} className={`nav-item ${activeView === item.label ? 'active' : ''}`} onClick={() => navigateTo(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.count && <span className="nav-count">{item.count}</span>}{activeView === item.label && <span className="nav-active-marker" />}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">YOUR WASHING MACHINE <button className="mini-add" onClick={() => setShowApplianceModal(true)} aria-label="View washing machine details"><Icon name="info" size={14} /></button></div>
        <div className="side-appliances">
          {appliances.map((appliance) => <button key={appliance.appliance_id} className={`side-appliance ${selectedApplianceId === appliance.appliance_id ? 'selected' : ''}`} onClick={() => { setSelectedApplianceId(appliance.appliance_id); setShowApplianceModal(true); }}><span className={`side-appliance-icon ${appliance.appliance_type}`}><Icon name={applianceIcon(appliance.appliance_type)} size={16} /></span><span className="side-appliance-copy"><strong>{appliance.model}</strong><span>{appliance.location_label || 'Home'}</span></span><span className={`warranty-indicator ${appliance.warranty_status === 'active' ? 'on' : 'off'}`} /></button>)}
        </div>
        <div className="sidebar-bottom"><div className="support-card"><div className="support-spark"><Icon name="sparkles" size={17} /></div><strong>Small problems.<br />Handled properly.</strong><span>Your WashPro repair concierge, from first check to final fix.</span><button onClick={startRecoveryDemo}>See how it works <Icon name="arrow" size={14} /></button><div className="support-stamp">FF / 01</div></div><button className="profile-row" onClick={() => notify('Profile settings will be added in a later step.', 'info')}><div className="profile-avatar">H</div><span><strong>Homeowner</strong><small>Personal plan</small></span><Icon name="settings" size={17} className="profile-settings" /></button></div>
      </aside>
      {isSidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation overlay" />}

      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button><span className="breadcrumb-muted">My home</span><Icon name="chevron" size={14} className="crumb-chevron" /><span className="breadcrumb-current">{activeView}</span></div><div className="topbar-right"><div className={`connection-pill ${connected ? 'is-connected' : 'is-local'}`}><span className="connection-dot" />{loading ? 'Connecting…' : connected ? 'Workflow connected' : 'Local demo mode'}</div><button className="icon-button notification-button" onClick={() => notify(connected ? 'No new repair alerts.' : 'Local demo mode is active. Start the backend to sync repairs.', 'info')} aria-label="Notifications"><Icon name="bell" size={18} /><span /></button><div className="topbar-divider" /><div className="date-chip"><span className="date-day">{new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(new Date())}</span><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date())}</span></div></div></header>

        {activeView === 'Repair cases' ? (
          <section className="page-wrap list-page"><div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> CASE MANAGEMENT</span><h1>Every fix,<br /><em>in one place.</em></h1><p>Track the washer issue, the upcoming visit, and every recovery step.</p></div><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="plus" size={17} /> Start a repair</button></div><div className="cases-toolbar"><div className="search-field"><Icon name="search" size={17} /><input placeholder="Search cases, symptoms…" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /><kbd>⌘ K</kbd></div><span className="result-count">{filteredCases.length} {filteredCases.length === 1 ? 'case' : 'cases'} in workspace</span></div>{filteredCases.length ? <div className="case-list">{filteredCases.map((item) => <CaseRow key={item.case_id} item={item} appliance={appliances.find((a) => a.appliance_id === item.appliance_id)} onSelect={() => { setCurrentCaseId(item.case_id); setActiveView('Overview'); }} />)}</div> : <EmptyCases onCreate={() => setShowCaseModal(true)} />}</section>
        ) : activeView === 'Appointments' ? (
          <section className="page-wrap appointments-page"><div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> VISIT PLANNER</span><h1>Good timing.<br /><em>Less waiting.</em></h1><p>Choose a time that works for home. Every booking is confirmed by you.</p></div><button className="secondary-button" onClick={refreshSlots}><Icon name="refresh" size={16} /> Refresh availability</button></div><div className="appointment-grid">{slots.filter((slot) => slot.status === 'available').map((slot) => <SlotCard key={slot.slot_id} slot={slot} onSelect={() => chooseSlot(slot)} />)}</div>{!currentCase && <div className="inline-note"><Icon name="info" size={18} /> Create a repair case first. Every appointment must be linked to an issue.</div>}</section>
        ) : activeView === 'Washer handbook' ? (
          <section className="page-wrap handbook-page"><div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> WASHER HANDBOOK</span><h1>Start safe.<br /><em>Know what to check.</em></h1><p>Plain-language first checks for WashPro 8kg symptoms, from vibration and noisy spin cycles to drainage concerns.</p></div></div><div className="handbook-grid">{appliances.map((appliance) => <article className="handbook-card" key={appliance.appliance_id}><div className="handbook-icon"><Icon name={applianceIcon(appliance.appliance_type)} size={22} /></div><span className="eyebrow">{applianceLabel(appliance.appliance_type)}</span><h3>{appliance.model}</h3><p>Vibration, loud spin cycles, drainage concerns, door-lock issues, and unbalanced loads.</p><button className="text-action" onClick={() => { setSelectedApplianceId('APL-1001'); setChatInput('What should I do about vibration?'); setActiveView('Overview'); }}>Get safe checks <Icon name="arrow" size={15} /></button></article>)}</div><div className="safety-banner"><div className="safety-icon"><Icon name="shield" size={22} /></div><div><strong>Safety comes before a quick fix.</strong><p>These guides are first-line checks, not confirmed diagnoses. Never open fixed panels or work on electrical or sealed components.</p></div></div></section>
        ) : (
          <div className="page-wrap overview-page">
            <section className="page-intro overview-intro"><div className="intro-copy"><span className="eyebrow"><span className="eyebrow-line" /> THE WASHING MACHINE REPAIR CONCIERGE</span><h1>Washer hiccup?<br /><em>We’ve got a plan.</em></h1><p>From “what’s that noise?” to “the repair is booked” — one washer, one connected repair journey.</p><div className="intro-actions"><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="plus" size={17} /> Start a repair <span className="button-shine" /></button><button className="plain-button" onClick={startRecoveryDemo} disabled={busyAction === 'demo'}><span className="play-dot"><Icon name="arrow" size={13} /></span>{busyAction === 'demo' ? 'Preparing walkthrough…' : 'Try the recovery demo'}</button></div><div className="intro-note"><span className="avatar-stack"><i>F</i><i><Icon name="shield" size={11} /></i></span><span><strong>One connected flow.</strong> No support-ticket scavenger hunt.</span></div></div><div className="hero-art-wrap"><div className="hero-art-top"><span><span className="online-dot" /> YOUR HOME, IN GOOD HANDS</span><span className="hero-art-index">NO. 001</span></div><div className="hero-art-circle circle-one" /><div className="hero-art-circle circle-two" /><div className="hero-art-sun" /><div className="hero-appliance-stage"><ApplianceArt type={selectedAppliance?.appliance_type || 'washing_machine'} /></div><div className="floating-note note-warranty"><span className="note-icon mint"><Icon name="shield" size={15} /></span><span><strong>Warranty check</strong><small>{selectedAppliance?.warranty_status === 'active' ? 'Saved record: active' : 'Coverage can be checked'}</small></span><Icon name="checkCircle" size={17} className="note-check" /></div><div className="floating-note note-status"><span className="note-icon coral"><Icon name="zap" size={15} /></span><span><strong>One less thing</strong><small>Handled, step by step</small></span></div><div className="hero-art-caption"><span>LESS CHASING.</span><span>MORE SORTED.</span></div><div className="hero-art-foot"><span>THE FIXFORWARD METHOD</span><span>01 — 03</span></div></div></section>

            <section className="stat-grid" aria-label="Home repair summary"><StatCard icon="wrench" label="Open repair cases" value={String(openCases).padStart(2, '0')} note={openCases ? `${openCases} need your attention` : 'Your queue is clear'} tone="blue" /><StatCard icon="calendar" label="Visits scheduled" value={String(scheduledCount).padStart(2, '0')} note={scheduledCount ? 'On the calendar' : 'Nothing booked yet'} tone="coral" /><StatCard icon="shield" label="Active warranty" value={`${activeWarrantyCount}/${appliances.length}`} note="Based on saved demo records" tone="lime" /></section>

            <div className="content-grid">
              <div className="content-main">
                <section className="recovery-card"><div className="recovery-card-top"><div><span className="eyebrow"><span className="eyebrow-line" /> THE SIGNATURE WORKFLOW</span><h2>When Plan A<br /><em>falls through.</em></h2></div><div className="recovery-stamp"><span>RECOVERY</span><strong>01<span>/</span>04</strong><i><Icon name="refresh" size={18} /></i></div></div><p className="recovery-description">A technician cancels. Your case doesn’t disappear into the void. FixForward keeps the thread, finds new availability, and lets you choose what happens next.</p><div className="journey-track"><div className="journey-step complete"><span className="journey-marker"><Icon name="check" size={14} /></span><span className="journey-label">Issue logged</span><small>Saved once</small></div><div className="journey-line done" /><div className="journey-step complete"><span className="journey-marker"><Icon name="check" size={14} /></span><span className="journey-label">Visit booked</span><small>Confirmed by you</small></div><div className="journey-line active-line" /><div className="journey-step waiting"><span className="journey-marker"><Icon name="refresh" size={14} /></span><span className="journey-label">Plan recovered</span><small>Ready to test</small></div></div><div className="recovery-card-footer"><div className="recovery-mini-copy"><span className="tiny-pulse" /> <span><strong>Try the full loop</strong><small>Open → book → cancel → recover</small></span></div><button className="dark-button" onClick={startRecoveryDemo} disabled={busyAction === 'demo'}>{busyAction === 'demo' ? 'Starting…' : 'Run recovery demo'} <Icon name="arrow" size={16} /></button></div><div className="recovery-card-number">FF / 01</div></section>

                <section className="appliances-section"><SectionTitle eyebrow="CONNECTED APPLIANCE" title="WashPro 8kg" action="View details" onAction={() => setShowApplianceModal(true)} /><div className="appliance-grid">{appliances.map((appliance, index) => <ApplianceCard key={appliance.appliance_id} appliance={appliance} index={index} selected={selectedApplianceId === appliance.appliance_id} onClick={() => { setSelectedApplianceId(appliance.appliance_id); setShowApplianceModal(true); }} />)}</div></section>

                <section className="case-section"><SectionTitle eyebrow="IN THE LOOP" title="Recent repair activity" action="All cases" onAction={() => navigateTo('Repair cases')} />{cases.length ? <div className="case-list compact-case-list">{cases.slice(0, 3).map((item) => <CaseRow key={item.case_id} item={item} appliance={appliances.find((a) => a.appliance_id === item.appliance_id)} onSelect={() => setCurrentCaseId(item.case_id)} />)}</div> : <div className="activity-empty"><div className="activity-empty-icon"><Icon name="clipboard" size={22} /></div><div><strong>Your first fix starts here.</strong><p>Open a case and we’ll keep the details, next steps and booking in one place.</p></div><button className="text-action" onClick={() => setShowCaseModal(true)}>Start here <Icon name="arrow" size={15} /></button></div>}</section>
              </div>

              <aside className="right-rail">
                <section className="concierge-card"><div className="concierge-top"><div className="concierge-mark"><BrandMark small /><span className="concierge-pulse" /></div><div className="concierge-heading"><strong>FixForward Guide</strong><span><span className="online-dot" /> Ready to help</span></div><button className="icon-button concierge-more" aria-label="Concierge details" onClick={() => notify(connected ? 'Connected to the local FixForward API. The current assistant router is rule-based; an LLM agent will be added next.' : 'You are in local demo mode. Start the API for persisted repair cases and live endpoint calls.', 'info')}><Icon name="info" size={17} /></button></div><div className="concierge-context"><Icon name="sparkles" size={14} /><span>REPAIR CONCIERGE <i>•</i> WORKFLOW PREVIEW</span></div><div className="chat-transcript" aria-live="polite">{messages.slice(-6).map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.stamp}-${index}-${message.text.slice(0, 12)}`}><div className="message-avatar">{message.role === 'assistant' ? <BrandMark small /> : 'Y'}</div><div className="message-body">{message.stamp && <span className="message-stamp">{message.stamp}</span>}<p>{message.text}</p></div></div>)}{busyAction === 'chat' && <div className="typing-indicator"><span /><span /><span /> <small>Checking the workflow…</small></div>}<div ref={chatEndRef} /></div><div className="suggestion-row"><button onClick={() => setChatInput('Check my washer warranty')}>Warranty check <Icon name="arrow" size={12} /></button><button onClick={() => setChatInput('What should I do about vibration?')}>Vibration help <Icon name="arrow" size={12} /></button></div><form className="chat-compose" onSubmit={sendMessage}><input aria-label="Ask FixForward Guide" placeholder="Tell me what’s going on…" value={chatInput} onChange={(event) => setChatInput(event.target.value)} /><button type="submit" aria-label="Send message" disabled={!chatInput.trim() || busyAction === 'chat'}><Icon name="send" size={17} /></button></form><div className="concierge-disclaimer"><Icon name="shield" size={13} /><span>Safety-first guidance. Simulated service data. You approve every booking.</span></div></section>

                <section className="next-up-card"><div className="next-up-heading"><span className="eyebrow">NEXT UP</span><Icon name="calendar" size={17} /></div>{currentCase?.status === 'scheduled' ? <><span className="next-up-date">{relativeDay(currentCase.starts_at)}</span><h3>Repair visit</h3><p>{currentCase.model || 'Home appliance'} · {formatTime(currentCase.starts_at)}</p><div className="next-up-person"><div className="technician-avatar">{(currentCase.technician_name || 'M')[0]}</div><span><strong>{currentCase.technician_name || 'Technician assigned'}</strong><small>Appointment booked</small></span><Icon name="checkCircle" size={18} className="next-up-check" /></div><button className="next-up-button" onClick={() => setShowSlotModal(true)}>View appointment <Icon name="arrow" size={15} /></button>{canRecover && <button className="simulate-link" onClick={simulateCancellation} disabled={busyAction === 'cancel'}><Icon name="refresh" size={14} /> {busyAction === 'cancel' ? 'Simulating…' : 'Simulate technician cancellation'}</button>}</> : currentCase?.status === 'needs_rescheduling' ? <><span className="next-up-date coral-text">Action needed</span><h3>Let's find a new time.</h3><p>Your case is still open. Pick an alternative visit slot to continue.</p><button className="next-up-button" onClick={() => { setPendingCaseId(currentCase.case_id); setShowSlotModal(true); }}>Find a replacement <Icon name="arrow" size={15} /></button></> : <><span className="next-up-date">No visit booked</span><h3>Make room for a fix.</h3><p>Open a repair case and find a time that fits your schedule.</p><button className="next-up-button" onClick={() => currentCase ? (setPendingCaseId(currentCase.case_id), setShowSlotModal(true)) : setShowCaseModal(true)}>{currentCase ? 'Choose a visit time' : 'Start a repair'} <Icon name="arrow" size={15} /></button></>}</section>

                <section className="trust-card"><div className="trust-card-icon"><Icon name="shield" size={20} /></div><div><strong>Permission before action.</strong><p>FixForward shows the exact slot and technician before booking. No silent commitments.</p></div><span className="trust-card-number">02</span></section>
              </aside>
            </div>
            <footer className="page-footer"><span>© {new Date().getFullYear()} FixForward AI</span><span><i /> A calmer way to fix things.</span><span className="footer-build">{connected ? 'API CONNECTED' : 'INTERACTIVE LOCAL PREVIEW'} · BUILD 0.2</span></footer>
          </div>
        )}
      </main>

      {showCaseModal && <Modal title="Let's get this sorted." description="Tell us what is happening with your WashPro 8kg. We’ll save the issue before suggesting a next step." onClose={() => setShowCaseModal(false)}><form className="case-form" onSubmit={submitNewCase}><label>Appliance in this demo<input value="WhirlNest WashPro 8kg washing machine" readOnly /></label><label>What have you noticed?<textarea value={issue} onChange={(event) => setIssue(event.target.value)} minLength={8} maxLength={1200} required placeholder="For example: loud rattling sound during the spin cycle…" rows={4} /></label><div className="form-help"><Icon name="shield" size={15} /><span>Do not include passwords or payment details. This creates a demo repair case only.</span></div><button className="primary-button full-button" type="submit" disabled={creatingCase}>{creatingCase ? 'Saving your case…' : 'Create repair case'} <Icon name="arrow" size={16} /></button></form></Modal>}

      {showSlotModal && <Modal title={pendingCaseId ? 'Find your next good time.' : 'Appointment availability'} description="Choose a slot to review. Nothing is booked until you confirm the exact time." onClose={() => { setShowSlotModal(false); setPendingSlot(null); }} wide><div className="slot-modal-meta"><span className="slot-meta-icon"><Icon name="shield" size={17} /></span><span><strong>{pendingCaseId || currentCase?.case_id || 'No case selected'}</strong><small>{cases.find((item) => item.case_id === (pendingCaseId || currentCase?.case_id))?.issue_description || 'Select an existing repair case first.'}</small></span><button className="text-action" onClick={refreshSlots}><Icon name="refresh" size={14} /> Refresh</button></div>{!pendingSlot ? <><div className="slot-list-heading"><span>AVAILABLE VISITS</span><span>{slots.filter((item) => item.status === 'available').length} slots</span></div><div className="slot-list">{slots.filter((slot) => slot.status === 'available').map((slot) => <button className="slot-option" key={slot.slot_id} onClick={() => chooseSlot(slot, pendingCaseId || currentCase?.case_id)}><span className="slot-date-block"><strong>{new Date(slot.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(slot.starts_at))}</small></span><span className="slot-info"><strong>{relativeDay(slot.starts_at)} · {formatTime(slot.starts_at)}</strong><small>{formatTime(slot.ends_at)} finish · 90-minute window</small></span><span className="slot-tech"><span className="technician-avatar small-tech">{(slot.technician_name || 'T')[0]}</span><span><strong>{slot.technician_name}</strong><small>Washer repair</small></span></span><span className="slot-arrow"><Icon name="chevron" size={17} /></span></button>)}</div>{!slots.some((slot) => slot.status === 'available') && <div className="slot-empty">No slots are currently available. Refresh to check again.</div>}</> : <div className="booking-confirmation"><button className="back-link" onClick={() => setPendingSlot(null)}><Icon name="arrow" size={14} className="back-arrow" /> Back to times</button><div className="booking-confirm-icon"><Icon name="calendar" size={25} /></div><span className="eyebrow">PLEASE REVIEW</span><h3>Confirm this visit?</h3><p>We’ll attach this appointment to the repair case shown below.</p><div className="confirmation-receipt"><div><span>REPAIR CASE</span><strong>{pendingCaseId}</strong></div><div><span>DATE & TIME</span><strong>{formatDate(pendingSlot.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })}, {formatTime(pendingSlot.starts_at)}</strong></div><div><span>TECHNICIAN</span><strong>{pendingSlot.technician_name}</strong></div><div><span>APPOINTMENT WINDOW</span><strong>{formatTime(pendingSlot.starts_at)} – {formatTime(pendingSlot.ends_at)}</strong></div></div><div className="confirmation-disclaimer"><Icon name="info" size={16} /> This is a simulated appointment. No real service provider will be contacted.</div><button className="primary-button full-button" onClick={confirmBooking} disabled={busyAction === 'booking'}>{busyAction === 'booking' ? 'Confirming…' : 'Yes, confirm appointment'} <Icon name="check" size={16} /></button><button className="cancel-text-button" onClick={() => setPendingSlot(null)}>Not yet — choose another time</button></div>}</Modal>}

      {showApplianceModal && <Modal title="Your washing machine." description="The single supported appliance in this demo workspace." onClose={() => setShowApplianceModal(false)}><div className="appliance-modal-list">{appliances.map((item) => <button key={item.appliance_id} className={`appliance-modal-row ${selectedApplianceId === item.appliance_id ? 'is-selected' : ''}`} onClick={() => { setSelectedApplianceId(item.appliance_id); setShowApplianceModal(false); }}><div className={`appliance-modal-icon ${item.appliance_type}`}><Icon name={applianceIcon(item.appliance_type)} size={20} /></div><div><strong>{item.brand} {item.model}</strong><span>{applianceLabel(item.appliance_type)} · {item.location_label || 'Home'}</span></div><span className={`warranty-tag ${item.warranty_status === 'active' ? 'active' : 'expired'}`}>{item.warranty_status === 'active' ? 'Warranty active' : 'Warranty expired'}</span><Icon name="chevron" size={16} /></button>)}</div><div className="form-help modal-footnote"><Icon name="info" size={15} /><span>The washing machine and warranty details are seeded demo records.</span></div></Modal>}

      {pendingSlot && !showSlotModal && <Modal title="Confirm appointment" onClose={() => setPendingSlot(null)}><p>This visit is for {pendingCaseId}. Confirm the time to save a demo booking.</p><button className="primary-button full-button" onClick={confirmBooking}>Confirm appointment</button></Modal>}
      {toast && <div className={`toast toast-${toast.type}`} role="status"><span className="toast-icon"><Icon name={toast.type === 'error' ? 'alert' : toast.type === 'info' ? 'info' : 'checkCircle'} size={17} /></span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}
    </div>
  );
}

function StatCard({ icon, label, value, note, tone }) {
  return <article className="stat-card"><div className={`stat-icon stat-${tone}`}><Icon name={icon} size={18} /></div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><span className={`stat-accent accent-${tone}`} /></article>;
}

function ApplianceCard({ appliance, index, selected, onClick }) {
  return <button className={`appliance-card ${selected ? 'appliance-selected' : ''}`} onClick={onClick}><div className="appliance-card-top"><span className={`appliance-mini-icon appliance-tone-${index}`}><Icon name={applianceIcon(appliance.appliance_type)} size={18} /></span><span className={`warranty-tag ${appliance.warranty_status === 'active' ? 'active' : 'expired'}`}><span />{appliance.warranty_status === 'active' ? 'Warranty active' : 'Warranty ended'}</span></div><div className={`appliance-card-art art-${index}`}><ApplianceArt type={appliance.appliance_type} /></div><div className="appliance-card-details"><span>{applianceLabel(appliance.appliance_type)}</span><strong>{appliance.model}</strong><small>{appliance.location_label || 'My home'}</small></div><span className="appliance-card-arrow"><Icon name="arrow" size={15} /></span></button>;
}

function CaseRow({ item, appliance, onSelect }) {
  const type = item.appliance_type || appliance?.appliance_type;
  return <button className="case-row" onClick={onSelect}><span className={`case-row-icon ${type || 'washing_machine'}`}><Icon name={applianceIcon(type)} size={18} /></span><span className="case-row-main"><strong>{item.issue_description || 'Appliance repair'}</strong><small>{item.case_id} <i>·</i> {item.model || appliance?.model || 'Home appliance'} <i>·</i> Updated {item.updated_at ? formatDate(item.updated_at) : 'just now'}</small></span><StatusPill status={item.status} /><Icon name="chevron" size={17} className="case-row-chevron" /></button>;
}

function SlotCard({ slot, onSelect }) {
  return <article className="appointment-card"><div className="appointment-date"><span>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(slot.starts_at)).toUpperCase()}</span><strong>{new Date(slot.starts_at).getDate()}</strong></div><div className="appointment-card-copy"><strong>{relativeDay(slot.starts_at)} · {formatTime(slot.starts_at)}</strong><span>{formatTime(slot.ends_at)} finish</span><div className="next-up-person"><div className="technician-avatar">{(slot.technician_name || 'T')[0]}</div><span><strong>{slot.technician_name}</strong><small>Washer repair</small></span></div></div><button className="slot-pick-button" onClick={onSelect}>Choose slot <Icon name="arrow" size={14} /></button></article>;
}

function EmptyCases({ onCreate }) {
  return <div className="empty-cases"><div className="empty-cases-art"><BrandMark /><span className="empty-spark spark-a">✳</span><span className="empty-spark spark-b">✳</span></div><span className="eyebrow">A CLEAN SLATE</span><h2>No repairs in the queue.</h2><p>When something needs attention, open a case here. We’ll keep the issue, appointment and recovery history connected.</p><button className="primary-button" onClick={onCreate}><Icon name="plus" size={17} /> Open your first case</button></div>;
}
