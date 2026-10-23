import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const STORAGE_KEY = 'fixforward.cases.v1';
const CURRENT_CASE_KEY = 'fixforward.currentCase.v1';
const PROFILE_STORAGE_KEY = 'fixforward.profile.v1';
const NOTIFICATION_READ_KEY = 'fixforward.notifications.read.v1';
const DEFAULT_PROFILE = { displayName: 'Homeowner', homeLabel: 'My home', appointmentReminders: true, productUpdates: false };
function readProfile() { try { return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}') }; } catch { return { ...DEFAULT_PROFILE }; } }
function readSavedNotificationIds() { try { const saved = JSON.parse(localStorage.getItem(NOTIFICATION_READ_KEY) || '[]'); return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []; } catch { return []; } }

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

function daysUntilDate(value) {
  if (!value) return null;
  let target;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  else target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((targetDay - todayDay) / 86400000);
}

function getWarrantyAssessment(appliance, fetchedRecord = null) {
  const expiry = fetchedRecord?.warranty_expiry || appliance?.warranty_expiry || '';
  const rawStatus = String(fetchedRecord?.warranty_status || appliance?.warranty_status || 'unknown').toLowerCase();
  const days = daysUntilDate(expiry);
  // When an expiry date is present, make the label consistent with today's date.
  const status = days === null ? rawStatus : (days < 0 ? 'expired' : 'active');
  let label = 'Coverage unconfirmed';
  let tone = 'unknown';
  let headline = 'Confirm coverage before arranging paid repair';
  let recommendation = 'The saved record does not establish whether the appliance is covered. Gather the proof of purchase and appliance model or serial number, then ask the manufacturer to confirm coverage and exclusions.';
  let timing = expiry ? `Listed expiry: ${expiry}` : 'No warranty expiry date is recorded';

  if (status === 'active') {
    label = days !== null && days <= 30 ? 'Expiring soon' : 'Recorded as active';
    tone = days !== null && days <= 30 ? 'soon' : 'active';
    headline = days !== null && days <= 30 ? 'The listed warranty expiry is approaching' : 'The saved record shows active warranty coverage';
    recommendation = 'Before approving paid work, contact the manufacturer or an authorized service partner and ask whether this symptom, parts, labour, and any visit or diagnostic fees are covered.';
    if (days === 0) timing = 'Listed expiry: today';
    else if (days === 1) timing = 'Listed expiry: tomorrow';
    else if (days !== null && days > 1) timing = `Listed expiry in ${days} days · ${expiry}`;
    else if (days === null) timing = expiry ? `Listed expiry: ${expiry}` : 'Expiry date not recorded';
  } else if (status === 'expired') {
    label = 'Recorded as expired';
    tone = 'expired';
    headline = 'The saved record indicates the warranty has ended';
    recommendation = 'Ask for a written estimate before approving service. Compare the diagnostic or call-out fee, parts, labour, repair warranty, and whether an authorized service partner is required.';
    timing = days !== null ? `Listed expiry was ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago · ${expiry}` : (expiry ? `Listed expiry: ${expiry}` : 'Expiry date not recorded');
  }

  return { status, label, tone, headline, recommendation, timing, expiry, days };
}
function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

// Prevent read-only repair-case questions from being mistaken for appointment intent.
// Requests to find available slots remain appointment-flow requests, even when the
// user explicitly says not to book anything yet.
function isReadOnlyCaseLookup(message) {
  const lower = String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hasCaseReference = /\b(?:repair\s+)?case\b/.test(lower) || /\bcase id\b/.test(lower);
  const asksForSavedFields = /\b(current status|case status|status of (?:the )?(?:repair )?case|saved appointment|appointment date|technician name|current slot id|slot id|from the database|repair database|saved repair case)\b/.test(lower);
  const asksForLookup = /\b(retrieve|look up|lookup|check|show|fetch|get|tell me|confirm|inspect)\b/.test(lower);
  const explicitlyReadOnly = /\b(?:do not|don't|dont|without)\b.{0,60}\b(?:change|modify|update|book|schedule|create|cancel|reschedule)\b/.test(lower);
  const explicitAvailabilityRequest = /\b(?:available|availability|open)\b.{0,50}\b(?:appointment|slots?|visits?|technicians?)\b/.test(lower)
    || /\b(?:appointment|technician|visit)\s+(?:availability|slots?)\b/.test(lower);
  return hasCaseReference && !explicitAvailabilityRequest && ((asksForLookup && asksForSavedFields) || explicitlyReadOnly);
}


// Appointment-history lookups are routed directly to the read-only REST endpoint.
// This deliberately bypasses the LLM's UI-action hint so history requests cannot open the slot picker.
function isAppointmentHistoryLookup(message) {
  const lower = String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const hasCaseId = /\bFF-[A-Z0-9-]+\b/i.test(lower);
  const asksHistory = /\b(?:appointment|booking|cancellation|rescheduling)\s+(?:history|records?|log)\b/.test(lower)
    || /\b(?:event log|history of appointments|previous cancelled appointment|previous canceled appointment)\b/.test(lower);
  const asksAvailability = /\b(?:show|find|check)\b.{0,50}\b(?:available slots|appointment availability|open appointment slots)\b/.test(lower);
  return hasCaseId && asksHistory && !asksAvailability;
}

function formatAppointmentHistoryResponse(result) {
  const caseRecord = result.case || {};
  const events = Array.isArray(result.history) ? result.history : [];
  const eventLines = events.map((item) => {
    const start = item.starts_at ? `${formatDate(item.starts_at, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} ${formatTime(item.starts_at)}` : 'time unavailable';
    const end = item.ends_at ? formatTime(item.ends_at) : '';
    const slot = item.slot_id || 'unknown slot';
    const technician = item.technician_name || 'technician not recorded';
    const previous = item.previous_slot_id ? `; previous slot ${item.previous_slot_id}` : '';
    const note = item.notes ? ` — ${item.notes}` : '';
    return `• ${item.event_type} · ${slot} · ${start}${end ? `–${end}` : ''} · ${technician} · recorded ${item.event_at || 'timestamp unavailable'}${previous}${note}`;
  });
  let text = `Read-only appointment history for ${caseRecord.case_id || 'the requested case'}\nCurrent case status: ${caseRecord.case_status || 'unknown'}\nCurrent slot ID: ${caseRecord.current_slot_id || 'None'}.`;
  text += `\n\n${eventLines.length ? eventLines.join('\n') : 'No appointment-history events have been recorded yet.'}`;
  if (result.history_note) text += `\n\nHistory limitation: ${result.history_note}`;
  text += '\n\nThis lookup did not change any records. All appointment information is simulated demo data.';
  return text;
}

async function apiRequest(path, options = {}) {
  const { timeoutMs = 6500, ...requestOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...requestOptions,
      signal: controller.signal,
      headers: { ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}), ...(requestOptions.headers || {}) },
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
  const [appointmentDate, setAppointmentDate] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState(() => readSavedNotificationIds());
  const [profile, setProfile] = useState(() => readProfile());
  const [profileDraft, setProfileDraft] = useState(() => readProfile());
  const [appointmentHistory, setAppointmentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [caseActivity, setCaseActivity] = useState([]);
  const [caseActivityLoading, setCaseActivityLoading] = useState(false);
  const [caseActivityNote, setCaseActivityNote] = useState('');
  const [handbookGuide, setHandbookGuide] = useState(null);
  const [handbookLoading, setHandbookLoading] = useState(false);
  const [handbookTopicKey, setHandbookTopicKey] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState(null);
  const [warrantyLoading, setWarrantyLoading] = useState(false);
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

  const explicitlySelectedCase = useMemo(
    () => cases.find((item) => item.case_id === currentCaseId) || null,
    [cases, currentCaseId],
  );
  const currentCase = explicitlySelectedCase || cases[0] || null;
  const selectedAppliance = useMemo(() => appliances.find((item) => item.appliance_id === selectedApplianceId) || appliances[0], [appliances, selectedApplianceId]);
  const warrantyAssessment = useMemo(() => getWarrantyAssessment(selectedAppliance, warrantyInfo), [selectedAppliance, warrantyInfo]);
  const notificationItems = useMemo(() => {
    const items = [];
    if (!connected) {
      items.push({
        id: 'system:local-demo-mode',
        title: 'Local demo mode',
        message: 'The backend is disconnected. Changes made in local demo mode stay in this browser and do not sync to the repair database.',
        detail: 'Connection status',
        icon: 'info',
        tone: 'info',
        actionLabel: 'View overview',
        actionView: 'Overview',
      });
    }

    cases.forEach((item) => {
      const caseId = item.case_id || 'unknown-case';
      if (item.status === 'needs_rescheduling') {
        items.push({
          id: `case:${caseId}:needs-rescheduling:${item.current_slot_id || item.slot_id || 'no-slot'}`,
          title: 'Replacement visit needed',
          message: `Case ${caseId} needs a new appointment time. The repair case remains open; choose a replacement slot when ready.`,
          detail: item.issue_description || 'Repair case needs attention',
          icon: 'alert',
          tone: 'warning',
          actionLabel: 'Choose replacement',
          actionView: 'Appointments',
          actionType: 'replacement',
          caseId,
        });
      } else if (item.status === 'scheduled' && profile.appointmentReminders) {
        const startTime = item.starts_at ? new Date(item.starts_at).getTime() : NaN;
        const isValidStart = Number.isFinite(startTime);
        const hasPassed = isValidStart && startTime < Date.now();
        const when = item.starts_at ? `${formatDate(item.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${formatTime(item.starts_at)}` : 'time not recorded';
        items.push({
          id: `case:${caseId}:appointment:${item.current_slot_id || item.slot_id || item.starts_at || 'unknown-slot'}`,
          title: hasPassed ? 'Review the scheduled visit' : 'Upcoming repair visit',
          message: hasPassed
            ? `The saved appointment time for ${caseId} has passed, but the case still shows as scheduled. Confirm the real-world outcome before updating the case.`
            : `${caseId} is scheduled for ${relativeDay(item.starts_at)}. Keep the appointment details handy.`,
          detail: `${when} · ${item.technician_name || 'Technician not assigned'}`,
          icon: hasPassed ? 'clock' : 'calendar',
          tone: hasPassed ? 'warning' : 'reminder',
          actionLabel: 'Review appointment',
          actionView: 'Appointments',
          caseId,
        });
      } else if (item.status === 'reported') {
        items.push({
          id: `case:${caseId}:reported`,
          title: 'Repair case is open',
          message: `Case ${caseId} has been created. No appointment is recorded yet; you can review it or book a visit when ready.`,
          detail: item.issue_description || 'Repair issue captured',
          icon: 'wrench',
          tone: 'info',
          actionLabel: 'Review case',
          actionView: 'Repair cases',
          caseId,
        });
      }
    });

    if (warrantyAssessment?.tone === 'soon' && selectedAppliance?.appliance_id) {
      items.push({
        id: `warranty:${selectedAppliance.appliance_id}:${warrantyAssessment.expiry || 'unknown-expiry'}`,
        title: 'Listed warranty expiry is approaching',
        message: 'The saved demo record shows an approaching warranty date. Ask the manufacturer to confirm actual coverage before approving paid repairs.',
        detail: warrantyAssessment.timing,
        icon: 'shield',
        tone: 'warning',
        actionLabel: 'Review warranty',
        actionView: 'Appliance & warranty',
      });
    }

    return items;
  }, [connected, cases, profile.appointmentReminders, selectedAppliance, warrantyAssessment]);
  const unreadNotificationCount = notificationItems.filter((item) => !readNotificationIds.includes(item.id)).length;
  const openCases = cases.filter(isOpenCase).length;
  const scheduledCount = cases.filter((item) => item.status === 'scheduled').length;
  const activeWarrantyCount = appliances.filter((item) => getWarrantyAssessment(item).status === 'active').length;
  const availableAppointmentSlots = slots.filter((slot) =>
    slot.status === 'available' && (!appointmentDate || localDateKey(slot.starts_at) === appointmentDate)
  );

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

  const refreshSlots = useCallback(async (dateFilter = appointmentDate) => {
    setSlotsLoading(true);
    const filterByDate = (items) => (items || []).filter((slot) =>
      !dateFilter || localDateKey(slot.starts_at) === dateFilter
    );
    try {
      if (connected) {
        const query = new URLSearchParams({ limit: '12' });
        if (dateFilter) query.set('date', dateFilter);
        const response = await apiRequest(`/api/slots?${query.toString()}`);
        const available = filterByDate(response.slots || []);
        setSlots(available);
        return available;
      }
      const localSlots = filterByDate(makeDemoSlots());
      setSlots(localSlots);
      return localSlots;
    } catch {
      const localSlots = filterByDate(makeDemoSlots());
      setSlots(localSlots);
      setConnected(false);
      return localSlots;
    } finally {
      setSlotsLoading(false);
    }
  }, [connected, appointmentDate]);


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

  const loadAppointmentHistory = useCallback(async (caseId) => {
    if (!caseId) { setAppointmentHistory([]); setHistoryError('Select a repair case to see its appointment history.'); return; }
    if (!connected) { setAppointmentHistory([]); setHistoryError('Connect the backend to retrieve saved appointment history.'); return; }
    setHistoryLoading(true);
    try {
      const result = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/history`);
      setAppointmentHistory(Array.isArray(result.history) ? result.history : []);
      setHistoryError(result.history_note || '');
    } catch (error) {
      setAppointmentHistory([]);
      setHistoryError(error.message || 'Appointment history could not be loaded.');
    } finally { setHistoryLoading(false); }
  }, [connected]);

  const loadCaseActivity = useCallback(async (caseId) => {
    if (!caseId) { setCaseActivity([]); setCaseActivityNote('Select a repair case to see its activity.'); return; }
    if (!connected || String(caseId).startsWith('LOCAL-FF-')) {
      setCaseActivity([]);
      setCaseActivityNote('Persistent activity is available when this case is saved in the connected repair database.');
      return;
    }
    setCaseActivityLoading(true);
    try {
      const result = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/activity`);
      setCaseActivity(Array.isArray(result.activity) ? result.activity : []);
      setCaseActivityNote(result.activity_note || '');
    } catch (error) {
      setCaseActivity([]);
      setCaseActivityNote(error.message || 'Saved case activity could not be loaded.');
    } finally { setCaseActivityLoading(false); }
  }, [connected]);

  useEffect(() => {
    if (['Appointments', 'Repair cases'].includes(activeView) && connected && currentCase?.case_id) {
      loadAppointmentHistory(currentCase.case_id);
      if (activeView === 'Repair cases') loadCaseActivity(currentCase.case_id);
    }
  }, [activeView, connected, currentCase?.case_id, loadAppointmentHistory, loadCaseActivity]);

  const updateSelectedCaseStatus = async (targetStatus) => {
    if (!currentCase) { notify('Select a repair case first.', 'error'); return; }
    const caseId = currentCase.case_id;
    const localOnly = !connected || String(caseId).startsWith('LOCAL-FF-');
    if (targetStatus === 'resolved') {
      if (!window.confirm(`Mark repair case ${caseId} as resolved? This records that the issue no longer needs service.`)) return;
    } else if (targetStatus === 'closed') {
      if (!window.confirm(`Close resolved repair case ${caseId}? This will mark the case as complete.`)) return;
    } else return;

    setBusyAction('case-status');
    try {
      const note = targetStatus === 'resolved'
        ? 'Homeowner confirmed the reported issue no longer needs repair service.'
        : 'Homeowner confirmed the resolved repair case can be closed.';
      if (!localOnly) {
        const result = await apiRequest(`/api/cases/${encodeURIComponent(caseId)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: targetStatus, notes: note }),
        });
        if (!result.ok || !result.case) throw new Error(result.error || result.message || 'The case status was not updated.');
        const normalized = normalizeCase({ ...result.case, timeline: [
          { title: targetStatus === 'resolved' ? 'Repair marked resolved' : 'Case closed', detail: note, tone: 'done', time: 'Just now' },
          ...(currentCase.timeline || []),
        ].slice(0, 5) }, appliances.find((item) => item.appliance_id === result.case.appliance_id));
        setCases((previous) => {
          const next = previous.map((item) => item.case_id === caseId ? { ...item, ...normalized } : item);
          saveCases(next);
          return next;
        });
      } else {
        updateCase(caseId, (item) => ({
          ...item,
          status: targetStatus,
          updated_at: new Date().toISOString(),
          timeline: [{ title: targetStatus === 'resolved' ? 'Repair marked resolved' : 'Case closed', detail: note, tone: 'done', time: 'Just now' }, ...(item.timeline || [])].slice(0, 5),
        }));
      }
      if (targetStatus === 'resolved') notify(`Case ${caseId} marked resolved.`);
      else notify(`Case ${caseId} is now closed.`);
      if (!localOnly) {
        await Promise.all([loadCaseActivity(caseId), loadAppointmentHistory(caseId), refreshCase(caseId)]);
      }
    } catch (error) {
      notify(error.message || 'The case status could not be updated.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const saveProfile = (event) => {
    event.preventDefault();
    const next = {
      ...DEFAULT_PROFILE,
      displayName: String(profileDraft.displayName || '').trim() || 'Homeowner',
      homeLabel: String(profileDraft.homeLabel || '').trim() || 'My home',
      appointmentReminders: Boolean(profileDraft.appointmentReminders),
      productUpdates: Boolean(profileDraft.productUpdates),
    };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    setProfile(next); setProfileDraft(next); setShowProfileModal(false);
    notify('Your local workspace preferences are saved.');
  };

  const persistReadNotificationIds = (nextIds) => {
    setReadNotificationIds(nextIds);
    try { localStorage.setItem(NOTIFICATION_READ_KEY, JSON.stringify(nextIds)); } catch { /* The notification center still works for this session. */ }
  };

  const markNotificationRead = (notificationId) => {
    if (!notificationId || readNotificationIds.includes(notificationId)) return;
    persistReadNotificationIds([...readNotificationIds, notificationId]);
  };

  const markAllNotificationsRead = () => {
    const nextIds = [...new Set([...readNotificationIds, ...notificationItems.map((item) => item.id)])];
    persistReadNotificationIds(nextIds);
    notify('All current notifications marked as read.', 'info');
  };

  const handleNotificationAction = async (item) => {
    markNotificationRead(item.id);
    if (item.caseId) setCurrentCaseId(item.caseId);
    setShowNotificationsModal(false);

    if (item.actionType === 'replacement' && item.caseId) {
      setPendingCaseId(item.caseId);
      await refreshSlots();
      setShowSlotModal(true);
      return;
    }

    setActiveView(item.actionView || 'Overview');
    if (item.actionView === 'Appliance & warranty') setShowApplianceModal(true);
  };

  const handleWarrantyCheck = async (applianceId) => {
    setWarrantyLoading(true);
    try {
      const result = await checkWarranty(applianceId);
      if (result?.ok === false) throw new Error(result.error || 'No warranty record was returned.');
      setWarrantyInfo(result);
      setAppliances((previous) => previous.map((item) => item.appliance_id === applianceId ? {
        ...item,
        warranty_status: result.warranty_status || item.warranty_status || 'unknown',
        warranty_expiry: result.warranty_expiry || item.warranty_expiry,
        purchase_date: result.purchase_date || item.purchase_date,
      } : item));
      notify('Saved warranty record refreshed. Manufacturer coverage is not independently verified.', 'info');
    } catch (error) { notify(error.message || 'Warranty details could not be retrieved.', 'error'); }
    finally { setWarrantyLoading(false); }
  };

  // Load a selected guide directly inside the handbook instead of routing users away to chat.
  const loadHandbookGuide = async (topic) => {
    setHandbookTopicKey(topic.key);
    setHandbookGuide(null);
    setHandbookLoading(true);
    try {
      const result = await getTroubleshooting('APL-1001', topic.prompt);
      if (result?.ok === false) throw new Error(result.error || 'A guide is not available for that symptom.');
      setHandbookGuide({ ...result, topic });
    } catch (error) {
      notify(error.message || 'The safe-check guide could not be retrieved.', 'error');
    } finally {
      setHandbookLoading(false);
    }
  };

  const closeHandbookGuide = () => {
    setHandbookGuide(null);
    setHandbookTopicKey('');
  };

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
    // If the user selected an existing case, continue that case's journey instead
    // of silently creating another case. This is especially important for testing
    // cancellation recovery on a specific scheduled visit.
    const targetCase = explicitlySelectedCase;
    setBusyAction('demo');
    try {
      if (targetCase?.status === 'scheduled') {
        await simulateCancellation(targetCase.case_id);
        return;
      }

      if (targetCase?.status === 'needs_rescheduling') {
        setCurrentCaseId(targetCase.case_id);
        setPendingCaseId(targetCase.case_id);
        await refreshSlots();
        setShowSlotModal(true);
        notify(`Case ${targetCase.case_id} is waiting for a replacement time. Select a slot and confirm only when ready.`, 'info');
        return;
      }

      if (targetCase) {
        setCurrentCaseId(targetCase.case_id);
        setPendingCaseId(targetCase.case_id);
        await refreshSlots();
        setShowSlotModal(true);
        setMessages((previous) => [...previous, {
          role: 'assistant',
          text: `Continuing with existing case ${targetCase.case_id}. Choose and confirm an appointment first; once it is scheduled, run this recovery action again to simulate a cancellation.`,
          stamp: 'RECOVERY WORKFLOW',
        }]);
        return;
      }

      // No case was explicitly selected: preserve the original first-run demo.
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
    const targetCase = cases.find((item) => item.case_id === caseId);
    if (targetCase?.status === 'scheduled') { notify(`Case ${caseId} already has a confirmed visit. Run cancellation recovery before selecting a replacement slot.`, 'info'); return; }
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

  const simulateCancellation = async (caseId = currentCase?.case_id) => {
    const targetCase = cases.find((item) => item.case_id === caseId)
      || (currentCase?.case_id === caseId ? currentCase : null);
    if (!targetCase) {
      notify('Select a repair case before simulating a technician cancellation.', 'error');
      return;
    }
    if (targetCase.status !== 'scheduled' || !targetCase.current_slot_id) {
      notify(`Case ${targetCase.case_id} must have a saved, scheduled appointment before cancellation recovery can run.`, 'info');
      return;
    }

    setBusyAction('cancel');
    setCurrentCaseId(targetCase.case_id);
    try {
      if (connected) {
        const response = await apiRequest(`/api/cases/${encodeURIComponent(targetCase.case_id)}/simulate-cancellation`, { method: 'POST' });
        if (response?.ok === false) throw new Error(response.error || response.message || 'The backend did not cancel this appointment.');
        // Refresh from the API after the state-changing call; the database is the source of truth.
        await refreshCase(targetCase.case_id);
      }

      updateCase(targetCase.case_id, (item) => ({
        ...item,
        status: 'needs_rescheduling',
        cancellation_reason: 'Technician unavailable (simulated demo event)',
        timeline: [{ title: 'Technician cancelled', detail: 'The original visit was cancelled in the demo system. Your repair case stays open.', tone: 'warning', time: 'Just now' }, ...(item.timeline || [])].slice(0, 5),
      }));

      if (connected) {
        await refreshSlots();
      } else {
        setSlots((previous) => previous.map((item) => item.slot_id === targetCase.current_slot_id ? { ...item, status: 'cancelled' } : item));
      }

      notify(`Cancellation simulated for ${targetCase.case_id}. The same repair case remains open.`, 'success');
      setMessages((previous) => [...previous, {
        role: 'assistant',
        text: `The technician cancellation was simulated for case ${targetCase.case_id}. The same repair case remains open. Choose a replacement slot and explicitly confirm it before the appointment changes.`,
        stamp: 'RECOVERY WORKFLOW',
      }]);
      setPendingCaseId(targetCase.case_id);
      setShowSlotModal(true);
    } catch (error) {
      notify(error.message || 'Could not simulate a cancellation.', 'error');
    } finally { setBusyAction(''); }
  };

  const getTroubleshooting = async (applianceId, symptoms) => {
    if (connected) {
      return apiRequest(`/api/appliances/${encodeURIComponent(applianceId)}/troubleshooting?symptoms=${encodeURIComponent(symptoms || 'unusual noise')}`);
    }

    // Give the local demo the same symptom-aware experience when the API is offline.
    // These are deliberately conservative user-safe checks, never a confirmed diagnosis.
    const lower = String(symptoms || '').toLowerCase().replace(/[’]/g, "'");
    const guides = [
      {
        key: 'urgent',
        match: /(smoke|burning|burnt smell|burning smell|sparking|electric shock|damaged wiring|grinding|water near electricity|water near socket|water near outlet|leak near electrics|leaking near power|near electrical connection)/,
        guide_title: 'Stop-use safety guidance',
        steps: [
          'Stop the cycle and do not run another test cycle.',
          'Keep clear of smoke, sparks, damaged wiring, and wet areas near electrical equipment. Do not touch a plug or socket if the area is wet or damaged.',
          'Only isolate power at the breaker if it is safely accessible from a dry location without touching damaged equipment; otherwise keep clear and get help.',
          'Contact a qualified appliance technician. If there is active smoke, fire, or immediate danger, contact local emergency services.',
        ],
        safety_note: 'Do not open the washer, work on wiring, or attempt to restart it. This is precautionary guidance, not a diagnosis.',
      },
      {
        key: 'leak',
        match: /(leak|leaking|water on floor|puddle|overflow|water coming out)/,
        guide_title: 'Washer leaking: safe first checks',
        steps: [
          'Stop the cycle and keep people away from water near sockets, plugs, or other electrical equipment.',
          'Do not touch the plug or controls from a wet area. Keep clear if the floor or electrical connections are wet.',
          'From a safe position, note whether water appears near a visible hose or the door area. Do not move the washer or open panels to investigate.',
          'For a continuing or significant leak, stop using the washer and arrange a qualified technician inspection.',
        ],
        safety_note: 'Water near electricity can be dangerous. Do not touch wet electrical equipment, pull the washer out, or remove panels.',
      },
      {
        key: 'vibration',
        match: /(vibrat|shak|moves across|moving during spin|unbalanced load|spin cycle|shakes)/,
        guide_title: 'Heavy vibration during spin: safe first checks',
        steps: [
          'Pause the cycle and wait until the drum has completely stopped. Do not hold or restrain a moving washer.',
          'If it is safe to open the door, redistribute a bunched or single heavy item evenly around the drum and avoid overloading it.',
          'From the outside, check that the washer stands level and is not touching a wall or cabinet. Do not pull a heavy machine out alone.',
          'If severe vibration continues with a balanced load, stop using the washer and arrange a qualified technician inspection.',
        ],
        safety_note: 'Do not reach into a moving drum, lift or reposition a heavy washer alone, remove panels, or work on wiring.',
      },
      {
        key: 'noise',
        match: /(noise|noisy|rattl|banging|clunk|metallic|grinding|squeal|whistle|loud sound)/,
        guide_title: 'Unusual washer noise: safe first checks',
        steps: [
          'Pause the cycle if the sound is sudden, loud, metallic, or grinding. Wait for the drum to stop before checking anything.',
          'When the machine is stopped, check the drum interior for a visible loose item and check clothing pockets before the next load.',
          'From the outside, confirm the washer is level and not touching nearby furniture, pipes, or a wall.',
          'If the noise persists or becomes harsh grinding, stop using the washer and contact a qualified technician.',
        ],
        safety_note: 'Do not remove panels or reach into moving parts. Stop immediately if there is smoke, burning, or water near electrical connections.',
      },
      {
        key: 'drainage',
        match: /(not draining|won't drain|wont drain|water remains|water left|standing water|drain|drainage|pump)/,
        guide_title: 'Water not draining: safe first checks',
        steps: [
          'If the cycle has stopped, note any displayed error code. Do not force the door open while water remains in the drum.',
          'If safe and accessible, visually check the external drain hose for an obvious kink; do not pull the washer out alone.',
          'Use only the manufacturer’s model-specific user-accessible drain/filter procedure. Let the appliance cool first if the manual warns that hot water may escape.',
          'If the drum stays full, the hose is damaged, or the issue returns, arrange a qualified technician inspection.',
        ],
        safety_note: 'Do not force the door, dismantle the pump, remove fixed panels, or touch a plug/socket from a wet area.',
      },
      {
        key: 'door',
        match: /(door|locked|won't unlock|wont unlock|will not open|won't open|cannot open|can't open|cant open)/,
        guide_title: 'Door will not open: safe first checks',
        steps: [
          'Wait a few minutes after the cycle ends; the lock may release only after the drum stops.',
          'Check whether water remains in the drum or the cycle is paused. Do not force the door or bypass its lock.',
          'If the manual provides a drain-only program, use it only when the appliance appears safe and there is no leak or electrical concern.',
          'If the door remains locked or water cannot drain, leave it closed and arrange a qualified technician inspection.',
        ],
        safety_note: 'Do not pry the door or dismantle the lock. Water may be hot; stop if the appliance appears unsafe.',
      },
      {
        key: 'start',
        match: /(won't start|wont start|will not start|not starting|doesn't start|doesnt start|no power|no display|not powering|start button)/,
        guide_title: 'Washer will not start: safe first checks',
        steps: [
          'Check that the door is fully closed and that the selected program has been started as described in the manual.',
          'Look for a delay-start timer or control/child lock indicator and follow the manual to change those settings.',
          'Only if the area is dry and the plug, cord, and socket appear undamaged, check whether the outlet has power using a normal household method.',
          'If the display stays off, a breaker repeatedly trips, or the washer still will not start, contact a qualified technician.',
        ],
        safety_note: 'Never open electrical panels or work on wiring. Do not repeatedly reset a tripping breaker or use damaged electrical equipment.',
      },
    ];
    const selectedGuide = guides.find((guide) => guide.match.test(lower)) || {
      key: 'general',
      guide_title: 'WashPro 8kg general safety checks',
      steps: [
        'If the washer is running, pause it and wait for the drum to stop before inspecting anything.',
        'Check the display for an error code and note it exactly as shown; consult the manufacturer’s manual for that code.',
        'Look only at user-accessible areas for an overloaded drum, a visibly kinked hose, or the machine touching a wall or cabinet.',
        'If the problem repeats, arrange a qualified technician inspection rather than removing panels or testing internal parts.',
      ],
      safety_note: 'Do not remove fixed panels, reach into a moving drum, or work on wiring. Stop using the appliance if it appears unsafe.',
    };
    return {
      ok: true,
      guide_key: selectedGuide.key || 'general',
      guide_title: selectedGuide.guide_title,
      steps: selectedGuide.steps,
      safety_note: selectedGuide.safety_note,
      assessment: 'These are initial user-safe checks, not a confirmed diagnosis.',
      demo_notice: 'Local demo guidance only; the workflow API is currently disconnected.',
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
      if (isAppointmentHistoryLookup(text)) {
        const requestedCaseId = text.match(/\bFF-[A-Z0-9-]+\b/i)?.[0];
        if (!connected) {
          setMessages((previous) => [...previous, {
            role: 'assistant',
            text: `I can't verify appointment history for ${requestedCaseId || 'that case'} because the backend is disconnected. No records were changed. Reconnect the workflow and retry.`,
            stamp: 'READ-ONLY HISTORY UNAVAILABLE',
          }]);
        } else {
          // This direct read-only lookup bypasses GPT action routing; it cannot open a booking modal.
          const result = await apiRequest(`/api/cases/${encodeURIComponent(requestedCaseId)}/history`);
          setMessages((previous) => [...previous, {
            role: 'assistant',
            text: formatAppointmentHistoryResponse(result),
            stamp: 'APPOINTMENT HISTORY · READ ONLY',
            toolEvents: [{ name: 'get_appointment_history', status: 'success', summary: `Loaded ${Array.isArray(result.history) ? result.history.length : 0} saved history record(s)` }],
          }]);
        }
      } else if (connected) {
        const result = await apiRequest('/api/assistant/chat', {
          method: 'POST',
          timeoutMs: 35000,
          body: JSON.stringify({
            message: text,
            history: messages.slice(-10).filter((item) => ['user', 'assistant'].includes(item.role)).map((item) => ({ role: item.role, text: item.text })),
            appliance_id: selectedAppliance?.appliance_id || 'APL-1001',
            case_id: currentCase?.case_id || null,
          }),
        });

        if (result.created_case?.case_id) {
          const normalized = normalizeCase(result.created_case, selectedAppliance || fallbackAppliances[0]);
          setCases((previous) => {
            const next = [normalized, ...previous.filter((item) => item.case_id !== normalized.case_id)];
            saveCases(next);
            return next;
          });
          setCurrentCaseId(normalized.case_id);
          notify(`Repair case ${normalized.case_id} created.`);
        }

        setMessages((previous) => [...previous, {
          role: 'assistant',
          text: result.reply || 'I checked the repair workflow. What would you like to do next?',
          stamp: result.stamp || 'FIXFORWARD AGENT',
          toolEvents: result.tool_events || [],
        }]);

        const action = result.action;
        // The backend's action hint is only for UI navigation. Do not let broad
        // appointment/technician keywords open the slot picker during a read-only lookup.
        if (isReadOnlyCaseLookup(text)) {
          // The assistant answer and tool events above are still displayed; no UI action runs.
        } else if (action?.type === 'open_repair_form') {
          setShowCaseModal(true);
        } else if (action?.type === 'open_appointments') {
          const targetCaseId = action.case_id || currentCase?.case_id;
          if (targetCaseId) {
            setPendingCaseId(targetCaseId);
            await refreshSlots();
            setShowSlotModal(true);
          } else {
            setShowCaseModal(true);
          }
        } else if (action?.type === 'simulate_cancellation') {
          if (currentCase?.status === 'scheduled') await simulateCancellation();
          else notify('Book a demo appointment first, then run cancellation recovery.', 'info');
        }
      } else if (isReadOnlyCaseLookup(text)) {
        const requestedCaseId = text.match(/\bFF-[A-Z0-9-]+\b/i)?.[0];
        const cachedCase = cases.find((item) => item.case_id?.toLowerCase() === requestedCaseId?.toLowerCase())
          || (currentCase && (!requestedCaseId || currentCase.case_id?.toLowerCase() === requestedCaseId.toLowerCase()) ? currentCase : null);
        if (!cachedCase) {
          setMessages((previous) => [...previous, {
            role: 'assistant',
            text: `I can’t verify ${requestedCaseId || 'that repair case'} from the repair database while the backend is disconnected. Reconnect the workflow and retry; I have not changed or booked anything.`,
            stamp: 'READ-ONLY LOOKUP UNAVAILABLE',
          }]);
        } else {
          const slotId = cachedCase.current_slot_id || cachedCase.slot_id || 'None';
          const appointment = cachedCase.starts_at
            ? `${formatDate(cachedCase.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${formatTime(cachedCase.starts_at)}`
            : 'No appointment saved';
          setMessages((previous) => [...previous, {
            role: 'assistant',
            text: `Cached repair case ${cachedCase.case_id}: status ${cachedCase.status || 'unknown'}; appointment ${appointment}; technician ${cachedCase.technician_name || 'not assigned'}; current slot ID ${slotId}. This is browser-cached information, not a live database verification. No changes were made.`,
            stamp: 'READ-ONLY CASE LOOKUP',
          }]);
        }
      } else if (lower.includes('warranty') || lower.includes('coverage')) {
        const match = appliances.find((item) => lower.includes(item.appliance_id.toLowerCase()) || lower.includes(item.model.toLowerCase()) || lower.includes(applianceLabel(item.appliance_type).toLowerCase()));
        const target = match || selectedAppliance;
        const result = await checkWarranty(target.appliance_id);
        const active = result.warranty_status === 'active';
        const assessment = getWarrantyAssessment(target, result);
        setMessages((previous) => [...previous, { role: 'assistant', text: `${result.appliance || `${target.brand} ${target.model}`}: saved demo warranty status — ${assessment.label.toLowerCase()}${result.warranty_expiry ? ` through ${formatDate(result.warranty_expiry, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. ${assessment.recommendation} ${result.note || 'Confirm actual coverage and exclusions with the manufacturer.'}`, stamp: 'WARRANTY LOOKUP' }]);
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
    { label: 'Appliance & warranty', icon: 'shield' },
    { label: 'Washer handbook', icon: 'book' },
  ];

  const filteredCases = cases.filter((item) => `${item.case_id} ${item.issue_description} ${item.model}`.toLowerCase().includes(searchTerm.toLowerCase()));
  const canRecover = currentCase?.status === 'scheduled';
  const recoveryActionLabel = !explicitlySelectedCase
    ? 'Run recovery demo'
    : explicitlySelectedCase.status === 'scheduled'
      ? `Simulate cancellation · ${explicitlySelectedCase.case_id}`
      : explicitlySelectedCase.status === 'needs_rescheduling'
        ? `Choose replacement · ${explicitlySelectedCase.case_id}`
        : `Continue case · ${explicitlySelectedCase.case_id}`;
  const recoveryActionBusy = ['demo', 'cancel', 'booking'].includes(busyAction);

  const navigateTo = (label) => {
    setActiveView(label);
    setSidebarOpen(false);
    if (label === 'Repair cases' && !cases.length) setShowCaseModal(true);
    if (label === 'Washer handbook') setMessages((previous) => [...previous, { role: 'assistant', text: 'The WashPro handbook focuses on safe first checks for vibration, noise, drainage, and spin-cycle issues. Choose a symptom in the message box to retrieve relevant guidance.', stamp: 'WASHER HANDBOOK' }]);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><BrandMark /><div><span className="brand-name">fixforward<span className="brand-period">.</span></span><span className="brand-kicker">HOME, IN GOOD HANDS</span></div><button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><Icon name="close" /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar"><Icon name="home" size={17} /></div><div className="workspace-copy"><strong>{profile.homeLabel}</strong><span>Personal workspace</span></div><Icon name="down" size={15} className="workspace-chevron" /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => <button key={item.label} className={`nav-item ${activeView === item.label ? 'active' : ''}`} onClick={() => navigateTo(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.count && <span className="nav-count">{item.count}</span>}{activeView === item.label && <span className="nav-active-marker" />}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-label">YOUR WASHING MACHINE <button className="mini-add" onClick={() => setShowApplianceModal(true)} aria-label="View washing machine details"><Icon name="info" size={14} /></button></div>
        <div className="side-appliances">
          {appliances.map((appliance) => <button key={appliance.appliance_id} className={`side-appliance ${selectedApplianceId === appliance.appliance_id ? 'selected' : ''}`} onClick={() => { setSelectedApplianceId(appliance.appliance_id); setShowApplianceModal(true); }}><span className={`side-appliance-icon ${appliance.appliance_type}`}><Icon name={applianceIcon(appliance.appliance_type)} size={16} /></span><span className="side-appliance-copy"><strong>{appliance.model}</strong><span>{appliance.location_label || 'Home'}</span></span><span className={`warranty-indicator ${appliance.warranty_status === 'active' ? 'on' : 'off'}`} /></button>)}
        </div>
        <div className="sidebar-bottom"><div className="support-card"><div className="support-spark"><Icon name="sparkles" size={17} /></div><strong>Small problems.<br />Handled properly.</strong><span>Your WashPro repair concierge, from first check to final fix.</span><button onClick={startRecoveryDemo} disabled={recoveryActionBusy}>{explicitlySelectedCase?.status === 'scheduled' ? 'Test cancellation recovery' : explicitlySelectedCase?.status === 'needs_rescheduling' ? 'Choose replacement time' : 'See how it works'} <Icon name={explicitlySelectedCase?.status === 'scheduled' ? 'refresh' : 'arrow'} size={14} /></button><div className="support-stamp">FF / 01</div></div><button className="profile-row" onClick={() => { setProfileDraft(profile); setShowProfileModal(true); }}><div className="profile-avatar">{(profile.displayName || 'H').trim().charAt(0).toUpperCase()}</div><span><strong>{profile.displayName}</strong><small>Workspace preferences</small></span><Icon name="settings" size={17} className="profile-settings" /></button></div>
      </aside>
      {isSidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation overlay" />}

      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button><span className="breadcrumb-muted">My home</span><Icon name="chevron" size={14} className="crumb-chevron" /><span className="breadcrumb-current">{activeView}</span></div><div className="topbar-right"><div className={`connection-pill ${connected ? 'is-connected' : 'is-local'}`}><span className="connection-dot" />{loading ? 'Connecting…' : connected ? 'Workflow connected' : 'Local demo mode'}</div><button className="icon-button notification-button" onClick={() => setShowNotificationsModal(true)} aria-label={unreadNotificationCount ? `Notifications, ${unreadNotificationCount} unread` : 'Notifications'}><Icon name="bell" size={18} />{unreadNotificationCount > 0 && <span className="notification-count">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}</button><div className="topbar-divider" /><div className="date-chip"><span className="date-day">{new Intl.DateTimeFormat('en-US', { day: '2-digit' }).format(new Date())}</span><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date())}</span></div></div></header>

        {activeView === 'Repair cases' ? (
          <section className="page-wrap list-page"><div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> CASE MANAGEMENT</span><h1>Every fix,<br /><em>in one place.</em></h1><p>Track the washer issue, the upcoming visit, and every recovery step.</p></div><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="plus" size={17} /> Start a repair</button></div><div className="cases-toolbar"><div className="search-field"><Icon name="search" size={17} /><input placeholder="Search cases, symptoms…" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /><kbd>⌘ K</kbd></div><span className="result-count">{filteredCases.length} {filteredCases.length === 1 ? 'case' : 'cases'} in workspace</span></div>{filteredCases.length ? <div className="case-list">{filteredCases.map((item) => <CaseRow key={item.case_id} item={item} appliance={appliances.find((a) => a.appliance_id === item.appliance_id)} onSelect={() => { setCurrentCaseId(item.case_id); setPendingCaseId(item.case_id); }} />)}</div> : <EmptyCases onCreate={() => setShowCaseModal(true)} />}{currentCase && <section className="case-detail-panel"><div className="panel-heading"><div><span className="eyebrow">SELECTED CASE DETAILS</span><h2>{currentCase.case_id}</h2></div><StatusPill status={currentCase.status} /></div><p className="case-detail-issue">{currentCase.issue_description}</p><div className="case-detail-grid"><div><small>Appliance</small><strong>{currentCase.brand || 'WhirlNest'} {currentCase.model || 'WashPro 8kg'}</strong></div><div><small>Created</small><strong>{formatDate(currentCase.created_at, { month: 'long', day: 'numeric', year: 'numeric' })}</strong></div><div><small>Technician</small><strong>{currentCase.technician_name || 'Not assigned'}</strong></div><div><small>Appointment</small><strong>{currentCase.starts_at ? `${formatDate(currentCase.starts_at, { month: 'short', day: 'numeric' })} · ${formatTime(currentCase.starts_at)}` : 'Not scheduled'}</strong></div></div>{currentCase.timeline?.length > 0 && <div className="case-timeline"><h3>Recent case activity</h3>{currentCase.timeline.map((event, index) => <div className="case-timeline-row" key={`${event.title}-${index}`}><span className={`timeline-dot ${event.tone || 'done'}`} /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{event.time || 'Recorded in case view'}</small></div></div>)}</div>}
            <section className="persistent-case-activity"><div className="activity-panel-heading"><div><span className="eyebrow">SAVED WORKFLOW LOG</span><h3>Case lifecycle activity</h3></div><button className="secondary-button" onClick={() => loadCaseActivity(currentCase.case_id)} disabled={caseActivityLoading || !connected || String(currentCase.case_id).startsWith('LOCAL-FF-')}><Icon name="refresh" size={14} /> {caseActivityLoading ? 'Loading…' : 'Refresh'}</button></div>
              {!connected || String(currentCase.case_id).startsWith('LOCAL-FF-') ? <p className="activity-empty-note">{caseActivityNote || 'Start the backend to load persistent case activity.'}</p> : caseActivityLoading ? <p className="activity-empty-note">Loading saved case activity…</p> : caseActivity.length ? <div className="saved-activity-list">{caseActivity.slice().reverse().map((event) => <article className="saved-activity-row" key={event.activity_id}><span className={`timeline-dot ${event.event_type === 'technician_cancelled' ? 'warning' : 'done'}`} /><div><div className="saved-activity-title"><strong>{String(event.event_type || 'activity').replaceAll('_', ' ')}</strong><small>{event.occurred_at ? `${formatDate(event.occurred_at, { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatTime(event.occurred_at)}` : 'Timestamp unavailable'}</small></div><p>{event.notes || 'No note saved.'}</p>{(event.from_status || event.to_status) && <small>{event.from_status || 'start'} → {event.to_status || 'updated'}</small>}</div></article>)}</div> : <p className="activity-empty-note">{caseActivityNote || 'No saved lifecycle activity yet. New actions will be recorded from this point forward.'}</p>}
            </section>
            <section className="case-linked-history"><div className="activity-panel-heading"><div><span className="eyebrow">LINKED AUDIT TRAIL</span><h3>Appointment history</h3></div><button className="secondary-button" onClick={() => loadAppointmentHistory(currentCase.case_id)} disabled={historyLoading || !connected}><Icon name="refresh" size={14} /> {historyLoading ? 'Loading…' : 'Refresh'}</button></div>
              {!connected ? <p className="activity-empty-note">Connect the backend to retrieve saved appointment history.</p> : historyLoading ? <p className="activity-empty-note">Loading appointment history…</p> : appointmentHistory.length ? <div className="saved-activity-list">{appointmentHistory.slice().reverse().map((event) => <article className="saved-activity-row" key={event.event_id}><span className={`timeline-dot ${event.event_type === 'cancelled' ? 'warning' : 'done'}`} /><div><div className="saved-activity-title"><strong>{String(event.event_type || 'appointment event').replaceAll('_', ' ')}</strong><small>{event.event_at ? `${formatDate(event.event_at, { month: 'short', day: 'numeric', year: 'numeric' })} · ${formatTime(event.event_at)}` : 'Timestamp unavailable'}</small></div><p>{event.slot_id || 'Slot unavailable'} · {event.technician_name || 'Technician not recorded'}{event.starts_at ? ` · ${formatDate(event.starts_at, { month: 'short', day: 'numeric' })}, ${formatTime(event.starts_at)}–${formatTime(event.ends_at)}` : ''}</p>{event.previous_slot_id && <small>Previous slot: {event.previous_slot_id}</small>}{event.notes && <small>{event.notes}</small>}</div></article>)}</div> : <p className="activity-empty-note">{historyError || 'No saved appointment-history events were returned for this case.'}</p>}
              {historyError && appointmentHistory.length > 0 && <div className="history-note"><Icon name="info" size={15} /><span>{historyError}</span></div>}
              <div className="history-disclaimer">Appointment records are read-only. Case lifecycle actions are recorded separately.</div>
            </section>
            <div className="case-detail-actions"><button className="secondary-button" onClick={() => setActiveView('Overview')}>Open overview</button>{currentCase.status === 'needs_rescheduling' && <button className="primary-button" onClick={async () => { setPendingCaseId(currentCase.case_id); await refreshSlots(); setShowSlotModal(true); }}>Reschedule visit <Icon name="arrow" size={14} /></button>}{currentCase.status === 'scheduled' && <button className="secondary-button" onClick={() => { setPendingCaseId(currentCase.case_id); setShowSlotModal(true); }}>View appointment <Icon name="calendar" size={14} /></button>}{!['resolved', 'closed'].includes(currentCase.status) && <button className="primary-button" onClick={() => updateSelectedCaseStatus('resolved')} disabled={busyAction === 'case-status' || (currentCase.status === 'scheduled' && currentCase.ends_at && new Date(currentCase.ends_at) > new Date())}><Icon name="checkCircle" size={14} /> {busyAction === 'case-status' ? 'Saving…' : 'Mark resolved'}</button>}{currentCase.status === 'scheduled' && currentCase.ends_at && new Date(currentCase.ends_at) > new Date() && <span className="case-action-hint">Resolution is available after the scheduled visit ends.</span>}{currentCase.status === 'resolved' && <button className="primary-button" onClick={() => updateSelectedCaseStatus('closed')} disabled={busyAction === 'case-status'}><Icon name="check" size={14} /> {busyAction === 'case-status' ? 'Saving…' : 'Close case'}</button>}{currentCase.status === 'closed' && <span className="case-closed-note"><Icon name="checkCircle" size={14} /> This case is complete.</span>}</div></section>}</section>
        ) : activeView === 'Appointments' ? (
          <section className="page-wrap appointments-page">
            <div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> VISIT PLANNER</span><h1>Good timing.<br /><em>Less waiting.</em></h1><p>Manage your saved visit, search by date, and review the appointment history linked to your repair case.</p></div><button className="secondary-button" onClick={() => refreshSlots(appointmentDate)} disabled={slotsLoading}><Icon name="refresh" size={16} /> {slotsLoading ? 'Refreshing…' : 'Refresh availability'}</button></div>
            <div className="appointment-planner-tools"><div className="appointment-case-select"><label htmlFor="appointment-case-select">Manage appointments for</label><select id="appointment-case-select" value={currentCase?.case_id || ''} onChange={(event) => setCurrentCaseId(event.target.value)} disabled={!cases.length}><option value="">Choose a repair case</option>{cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.case_id} · {item.issue_description.slice(0, 54)}</option>)}</select></div><div className="appointment-date-filter"><label htmlFor="appointment-date-filter">Search availability by date</label><div className="appointment-date-filter-controls"><input id="appointment-date-filter" type="date" min={localDateKey(new Date())} value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} /><button className="primary-button" onClick={() => refreshSlots(appointmentDate)} disabled={slotsLoading}>{slotsLoading ? 'Searching…' : 'Find times'}</button><button className="date-clear-button" onClick={() => { setAppointmentDate(''); refreshSlots(''); }} disabled={slotsLoading || !appointmentDate}>Clear</button></div></div></div>
            <section className="active-appointment-panel"><div className="panel-heading"><div><span className="eyebrow">SELECTED REPAIR CASE</span><h2>{currentCase?.case_id || 'No case selected'}</h2></div>{currentCase && <StatusPill status={currentCase.status} />}</div>
              {!currentCase ? <><p>Appointments must belong to a repair case so the visit stays connected to the issue.</p><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="plus" size={16} /> Create a repair case</button></>
              : currentCase.status === 'scheduled' ? <div className="saved-appointment"><div className="appointment-date"><span>{currentCase.starts_at ? new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(currentCase.starts_at)).toUpperCase() : 'VISIT'}</span><strong>{currentCase.starts_at ? new Date(currentCase.starts_at).getDate() : '—'}</strong></div><div><h3>Appointment confirmed</h3><p>{currentCase.starts_at ? `${formatDate(currentCase.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${formatTime(currentCase.starts_at)}–${formatTime(currentCase.ends_at)}` : 'Time saved in the case record'}</p><span className="appointment-tech-line"><Icon name="wrench" size={15} /> {currentCase.technician_name || 'Technician not recorded'} · {currentCase.current_slot_id || currentCase.slot_id || 'Slot ID unavailable'}</span></div><button className="text-action" onClick={() => simulateCancellation(currentCase.case_id)} disabled={busyAction === 'cancel'}><Icon name="refresh" size={14} /> Test cancellation recovery</button></div>
              : currentCase.status === 'needs_rescheduling' ? <div className="reschedule-banner"><Icon name="alert" size={20} /><div><strong>Replacement appointment needed</strong><p>Your original visit was cancelled in this demo. Your repair case remains open.</p></div><button className="primary-button" onClick={async () => { setPendingCaseId(currentCase.case_id); await refreshSlots(); setShowSlotModal(true); }}>Find a new time <Icon name="arrow" size={14} /></button></div>
              : ['resolved', 'closed'].includes(currentCase.status) ? <div className="no-appointment-row"><span>This case is {currentCase.status}. Reopen the case as a new repair request if another visit is needed.</span><button className="secondary-button" onClick={() => setActiveView('Repair cases')}>View case details <Icon name="arrow" size={14} /></button></div>
              : <div className="no-appointment-row"><span>No appointment is saved for this case yet.</span><button className="primary-button" onClick={async () => { setPendingCaseId(currentCase.case_id); await refreshSlots(); setShowSlotModal(true); }}>Choose a visit time <Icon name="arrow" size={14} /></button></div>}
            </section>
            <div className="section-heading appointments-section-heading"><div><span className="eyebrow">AVAILABLE VISITS</span><h2>{appointmentDate ? `Times on ${formatDate(`${appointmentDate}T12:00:00`, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Find a time that fits'}</h2></div><span className="result-count">{availableAppointmentSlots.length} available</span></div>
            <div className="appointment-grid">{availableAppointmentSlots.map((slot) => <SlotCard key={slot.slot_id} slot={slot} onSelect={() => currentCase?.status === 'scheduled' ? notify('This case already has a confirmed visit. Simulate a technician cancellation before selecting a replacement.', 'info') : chooseSlot(slot, currentCase?.case_id)} />)}</div>{!availableAppointmentSlots.length && <div className="slot-empty">{appointmentDate ? `No available visits are listed for ${formatDate(`${appointmentDate}T12:00:00`, { month: 'long', day: 'numeric', year: 'numeric' })}. Try another date or clear the filter.` : 'No available slots are loaded. Select Refresh availability to check again.'}</div>}
            <section className="appointment-history-panel"><div className="panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Appointment history</h2></div><button className="secondary-button" onClick={() => loadAppointmentHistory(currentCase?.case_id)} disabled={historyLoading || !currentCase || !connected}><Icon name="refresh" size={14} /> {historyLoading ? 'Loading…' : 'Refresh history'}</button></div>
              {!currentCase ? <p>Select a repair case to view its history.</p> : !connected ? <p>Saved history appears here when the backend is connected. Local preview does not claim to have database history.</p> : historyLoading ? <p>Retrieving read-only history…</p> : appointmentHistory.length ? <div className="history-list">{appointmentHistory.map((event) => <article className="history-event" key={event.event_id}><span className={`history-event-icon ${event.event_type === 'cancelled' || event.event_type === 'cancellation' ? 'history-warning' : ''}`}><Icon name={event.event_type === 'cancelled' || event.event_type === 'cancellation' ? 'alert' : event.event_type === 'rescheduled' ? 'refresh' : 'calendar'} size={16} /></span><div><div className="history-event-title"><strong>{String(event.event_type || 'appointment event').replaceAll('_', ' ')}</strong><span>{event.event_at ? formatDate(event.event_at, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Time not recorded'} {event.event_at ? formatTime(event.event_at) : ''}</span></div><p>{event.slot_id || 'Slot unavailable'} · {event.technician_name || 'Technician not recorded'}{event.starts_at ? ` · ${formatDate(event.starts_at, { month: 'short', day: 'numeric' })}, ${formatTime(event.starts_at)}–${formatTime(event.ends_at)}` : ''}</p>{event.previous_slot_id && <small>Previous slot: {event.previous_slot_id}</small>}{event.notes && <small>{event.notes}</small>}</div></article>)}</div> : <p>No saved appointment-history events were returned for this case.</p>}
              {historyError && <div className="history-note"><Icon name="info" size={15} /><span>{historyError}</span></div>}
              <div className="history-disclaimer">Read-only audit view. Appointment records shown here are simulated demo data.</div>
            </section>
          </section>
        ) : activeView === 'Appliance & warranty' ? (
          <section className="page-wrap appliance-management-page">
            <div className="page-intro compact-intro">
              <div>
                <span className="eyebrow"><span className="eyebrow-line" /> APPLIANCE RECORD</span>
                <h1>Know your machine.<br /><em>Know your coverage.</em></h1>
                <p>Review the saved appliance details, refresh its warranty record, and see practical next steps before arranging a repair.</p>
              </div>
              <button className="primary-button" onClick={() => setShowApplianceModal(true)}><Icon name="info" size={16} /> View full details</button>
            </div>

            <div className="appliance-management-grid">
              <section className="appliance-record-card">
                <div className="appliance-record-top">
                  <span className="appliance-mini-icon appliance-tone-0"><Icon name="washer" size={20} /></span>
                  <span className="eyebrow">SUPPORTED DEMO APPLIANCE</span>
                  <span className={`warranty-tag ${warrantyAssessment.tone}`}>{warrantyAssessment.label}</span>
                </div>
                <div className="appliance-record-art"><ApplianceArt type={selectedAppliance?.appliance_type || 'washing_machine'} /></div>
                <h2>{selectedAppliance?.brand || 'WhirlNest'} {selectedAppliance?.model || 'WashPro 8kg'}</h2>
                <p>{selectedAppliance?.location_label || 'Home · Utility area'}</p>
                <div className="appliance-detail-grid appliance-management-details">
                  <div><small>Appliance ID</small><strong>{selectedAppliance?.appliance_id || 'APL-1001'}</strong></div>
                  <div><small>Appliance type</small><strong>Washing machine</strong></div>
                  <div><small>Purchase date</small><strong>{selectedAppliance?.purchase_date ? formatDate(selectedAppliance.purchase_date, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded'}</strong></div>
                  <div><small>Listed warranty expiry</small><strong>{warrantyAssessment.expiry ? formatDate(warrantyAssessment.expiry, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded'}</strong></div>
                </div>
                <div className="appliance-record-actions">
                  <button className="secondary-button" onClick={() => handleWarrantyCheck(selectedAppliance?.appliance_id || 'APL-1001')} disabled={warrantyLoading}><Icon name="shield" size={15} /> {warrantyLoading ? 'Refreshing record…' : 'Refresh warranty'}</button>
                  <button className="primary-button" onClick={() => { setIssue(`Please inspect my ${selectedAppliance?.brand || 'WhirlNest'} ${selectedAppliance?.model || 'WashPro 8kg'}.`); setShowCaseModal(true); }}><Icon name="plus" size={15} /> Start repair case</button>
                </div>
              </section>

              <section className={`warranty-advice-card warranty-advice-${warrantyAssessment.tone}`} aria-live="polite">
                <div className="warranty-advice-kicker"><span><Icon name="shield" size={17} /></span><div><span className="eyebrow">WARRANTY REVIEW</span><small>{warrantyAssessment.timing}</small></div></div>
                <h2>{warrantyAssessment.headline}</h2>
                <p>{warrantyAssessment.recommendation}</p>
                <div className="warranty-checklist">
                  <strong>Before you approve a repair</strong>
                  <div><Icon name="checkCircle" size={15} /><span>Ask whether the reported symptom is covered.</span></div>
                  <div><Icon name="checkCircle" size={15} /><span>Confirm parts, labour, call-out and diagnostic fees.</span></div>
                  <div><Icon name="checkCircle" size={15} /><span>Request written terms and keep the purchase proof.</span></div>
                </div>
                <div className="warranty-advice-actions">
                  <button className="secondary-button" onClick={() => { setChatInput('Help me understand the warranty record for my WhirlNest WashPro 8kg and what to ask the manufacturer.'); setActiveView('Overview'); }}><Icon name="message" size={15} /> Ask FixForward Guide</button>
                  <button className="text-action" onClick={() => setShowApplianceModal(true)}>Review saved details <Icon name="arrow" size={14} /></button>
                </div>
                <div className="warranty-demo-disclaimer"><Icon name="info" size={14} /><span>This status is calculated from simulated demo data. It is not a manufacturer eligibility decision and does not confirm covered repairs.</span></div>
              </section>
            </div>

            <section className="warranty-next-steps">
              <div><span className="eyebrow"><span className="eyebrow-line" /> RECOMMENDED NEXT STEPS</span><h2>Keep the decision in your hands.</h2><p>FixForward organizes the information; you decide whether to troubleshoot, contact the manufacturer, or open a repair case.</p></div>
              <div className="warranty-next-step-actions"><button className="secondary-button" onClick={() => { setActiveView('Washer handbook'); setHandbookGuide(null); }}><Icon name="book" size={15} /> Safe troubleshooting</button><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="wrench" size={15} /> Open repair case</button></div>
            </section>
          </section>
        ) : activeView === 'Washer handbook' ? (
          <section className="page-wrap handbook-page"><div className="page-intro compact-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> WASHER HANDBOOK</span><h1>Start safe.<br /><em>Know what to check.</em></h1><p>Choose a symptom to load practical, safety-first checks for the WhirlNest WashPro 8kg. Guides appear here without leaving the handbook.</p></div></div><div className="handbook-grid">{[{ key: 'vibration', title: 'Heavy vibration', description: 'The machine shakes or moves during spin.', prompt: 'What should I do about heavy vibration during the spin cycle?', icon: 'refresh' }, { key: 'noise', title: 'Unusual noise', description: 'Rattling, grinding, or loud spin-cycle sounds.', prompt: 'Help me troubleshoot unusual noise from my washer safely.', icon: 'alert' }, { key: 'drain', title: 'Water not draining', description: 'Water remains in the drum after the cycle.', prompt: 'My washing machine is not draining. Give me safe first checks.', icon: 'zap' }, { key: 'door', title: 'Door will not open', description: 'The door stays locked after a cycle.', prompt: 'My washer door will not open. What safe checks can I try?', icon: 'shield' }, { key: 'start', title: 'Will not start', description: 'The cycle does not begin when expected.', prompt: 'My washing machine will not start. Give me safe first checks.', icon: 'power' }].map((topic) => <article className={`handbook-card symptom-card ${handbookTopicKey === topic.key ? 'symptom-card-active' : ''}`} key={topic.key}><div className="handbook-icon"><Icon name={topic.icon === 'power' ? 'zap' : topic.icon} size={22} /></div><span className="eyebrow">SAFE FIRST CHECKS</span><h3>{topic.title}</h3><p>{topic.description}</p><button className="text-action" onClick={() => loadHandbookGuide(topic)} disabled={handbookLoading}>{handbookLoading && handbookTopicKey === topic.key ? 'Loading guide…' : 'Open guide'} <Icon name="arrow" size={15} /></button></article>)}</div>{(handbookLoading || handbookGuide) && <section className="handbook-result-panel" aria-live="polite"><div className="handbook-result-heading"><div><span className="eyebrow">FIXFORWARD GUIDE</span><h2>{handbookLoading ? 'Retrieving safe checks…' : handbookGuide?.guide_title || handbookGuide?.topic?.title || 'Safe first checks'}</h2></div><button className="icon-button" onClick={closeHandbookGuide} aria-label="Close guide results"><Icon name="close" size={17} /></button></div>{handbookLoading ? <p className="handbook-loading-copy">Retrieving the saved troubleshooting guide for this symptom. No appliance settings or repair records will be changed.</p> : <><p className="handbook-assessment">{handbookGuide?.assessment || 'These are initial user-safe checks, not a confirmed diagnosis.'}</p><ol className="handbook-steps">{(handbookGuide?.steps || []).map((step, index) => <li key={`${handbookGuide?.topic?.key || 'step'}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol><div className="handbook-safety-note"><Icon name="shield" size={18} /><div><strong>Safety note</strong><p>{handbookGuide?.safety_note || 'Do not remove fixed panels or work on wiring. Stop using the appliance if it appears unsafe.'}</p></div></div><div className="handbook-result-actions"><button className="primary-button" onClick={() => { setIssue(handbookGuide?.topic?.prompt || 'Please inspect my washing machine.'); setShowCaseModal(true); }}><Icon name="plus" size={15} /> Open repair case</button><button className="secondary-button" onClick={() => { setChatInput(handbookGuide?.topic?.prompt || 'Help me troubleshoot my washing machine safely.'); setActiveView('Overview'); }}>Ask FixForward Guide <Icon name="arrow" size={14} /></button></div></>}</section>}<div className="safety-banner"><div className="safety-icon"><Icon name="shield" size={22} /></div><div><strong>Safety comes before a quick fix.</strong><p>These guides are first-line checks, not confirmed diagnoses. Never open fixed panels or work on electrical or sealed components.</p></div></div></section>
        ) : (
          <div className="page-wrap overview-page">
            <section className="page-intro overview-intro"><div className="intro-copy"><span className="eyebrow"><span className="eyebrow-line" /> THE WASHING MACHINE REPAIR CONCIERGE</span><h1>Washer hiccup?<br /><em>We’ve got a plan.</em></h1><p>From “what’s that noise?” to “the repair is booked” — one washer, one connected repair journey.</p><div className="intro-actions"><button className="primary-button" onClick={() => setShowCaseModal(true)}><Icon name="plus" size={17} /> Start a repair <span className="button-shine" /></button><button className="plain-button" onClick={startRecoveryDemo} disabled={recoveryActionBusy}><span className="play-dot"><Icon name={explicitlySelectedCase?.status === 'scheduled' ? 'refresh' : 'arrow'} size={13} /></span>{recoveryActionBusy ? 'Preparing recovery…' : (explicitlySelectedCase ? recoveryActionLabel : 'Try the recovery demo')}</button></div><div className="intro-note"><span className="avatar-stack"><i>F</i><i><Icon name="shield" size={11} /></i></span><span><strong>One connected flow.</strong> No support-ticket scavenger hunt.</span></div></div><div className="hero-art-wrap"><div className="hero-art-top"><span><span className="online-dot" /> YOUR HOME, IN GOOD HANDS</span><span className="hero-art-index">NO. 001</span></div><div className="hero-art-circle circle-one" /><div className="hero-art-circle circle-two" /><div className="hero-art-sun" /><div className="hero-appliance-stage"><ApplianceArt type={selectedAppliance?.appliance_type || 'washing_machine'} /></div><div className="floating-note note-warranty"><span className="note-icon mint"><Icon name="shield" size={15} /></span><span><strong>Warranty check</strong><small>{selectedAppliance?.warranty_status === 'active' ? 'Saved record: active' : 'Coverage can be checked'}</small></span><Icon name="checkCircle" size={17} className="note-check" /></div><div className="floating-note note-status"><span className="note-icon coral"><Icon name="zap" size={15} /></span><span><strong>One less thing</strong><small>Handled, step by step</small></span></div><div className="hero-art-caption"><span>LESS CHASING.</span><span>MORE SORTED.</span></div><div className="hero-art-foot"><span>THE FIXFORWARD METHOD</span><span>01 — 03</span></div></div></section>

            <section className="stat-grid" aria-label="Home repair summary"><StatCard icon="wrench" label="Open repair cases" value={String(openCases).padStart(2, '0')} note={openCases ? `${openCases} need your attention` : 'Your queue is clear'} tone="blue" /><StatCard icon="calendar" label="Visits scheduled" value={String(scheduledCount).padStart(2, '0')} note={scheduledCount ? 'On the calendar' : 'Nothing booked yet'} tone="coral" /><StatCard icon="shield" label="Active warranty" value={`${activeWarrantyCount}/${appliances.length}`} note="Based on saved demo records" tone="lime" /></section>

            <div className="content-grid">
              <div className="content-main">
                <section className="recovery-card"><div className="recovery-card-top"><div><span className="eyebrow"><span className="eyebrow-line" /> THE SIGNATURE WORKFLOW</span><h2>When Plan A<br /><em>falls through.</em></h2></div><div className="recovery-stamp"><span>RECOVERY</span><strong>01<span>/</span>04</strong><i><Icon name="refresh" size={18} /></i></div></div><p className="recovery-description">A technician cancels. Your case doesn’t disappear into the void. FixForward keeps the thread, finds new availability, and lets you choose what happens next.</p><div className="journey-track"><div className="journey-step complete"><span className="journey-marker"><Icon name="check" size={14} /></span><span className="journey-label">Issue logged</span><small>Saved once</small></div><div className="journey-line done" /><div className="journey-step complete"><span className="journey-marker"><Icon name="check" size={14} /></span><span className="journey-label">Visit booked</span><small>Confirmed by you</small></div><div className="journey-line active-line" /><div className="journey-step waiting"><span className="journey-marker"><Icon name="refresh" size={14} /></span><span className="journey-label">Plan recovered</span><small>Ready to test</small></div></div><div className="recovery-card-footer"><div className="recovery-mini-copy"><span className="tiny-pulse" /> <span><strong>Try the full loop</strong><small>Open → book → cancel → recover</small></span></div><button className="dark-button" onClick={startRecoveryDemo} disabled={recoveryActionBusy}>{recoveryActionBusy ? 'Working…' : recoveryActionLabel} <Icon name={explicitlySelectedCase?.status === 'scheduled' ? 'refresh' : 'arrow'} size={16} /></button></div><div className="recovery-card-number">FF / 01</div></section>

                <section className="appliances-section"><SectionTitle eyebrow="CONNECTED APPLIANCE" title="WashPro 8kg" action="View details" onAction={() => setShowApplianceModal(true)} /><div className="appliance-grid">{appliances.map((appliance, index) => <ApplianceCard key={appliance.appliance_id} appliance={appliance} index={index} selected={selectedApplianceId === appliance.appliance_id} onClick={() => { setSelectedApplianceId(appliance.appliance_id); setShowApplianceModal(true); }} />)}</div></section>

                <section className="case-section"><SectionTitle eyebrow="IN THE LOOP" title="Recent repair activity" action="All cases" onAction={() => navigateTo('Repair cases')} />{cases.length ? <div className="case-list compact-case-list">{cases.slice(0, 3).map((item) => <CaseRow key={item.case_id} item={item} appliance={appliances.find((a) => a.appliance_id === item.appliance_id)} onSelect={() => setCurrentCaseId(item.case_id)} />)}</div> : <div className="activity-empty"><div className="activity-empty-icon"><Icon name="clipboard" size={22} /></div><div><strong>Your first fix starts here.</strong><p>Open a case and we’ll keep the details, next steps and booking in one place.</p></div><button className="text-action" onClick={() => setShowCaseModal(true)}>Start here <Icon name="arrow" size={15} /></button></div>}</section>
              </div>

              <aside className="right-rail">
                <section className="concierge-card"><div className="concierge-top"><div className="concierge-mark"><BrandMark small /><span className="concierge-pulse" /></div><div className="concierge-heading"><strong>FixForward Guide</strong><span><span className="online-dot" /> Ready to help</span></div><button className="icon-button concierge-more" aria-label="Concierge details" onClick={() => notify(connected ? 'Connected to the FixForward API. Amazon Bedrock tool-use is enabled when BEDROCK_MODEL_ID and AWS credentials are configured; otherwise the local workflow router remains available.' : 'You are in local demo mode. Start the API for persisted repair cases and agent endpoint calls.', 'info')}><Icon name="info" size={17} /></button></div><div className="concierge-context"><Icon name="sparkles" size={14} /><span>REPAIR CONCIERGE <i>•</i> WORKFLOW PREVIEW</span></div><div className="chat-transcript" aria-live="polite">{messages.slice(-6).map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.stamp}-${index}-${message.text.slice(0, 12)}`}><div className="message-avatar">{message.role === 'assistant' ? <BrandMark small /> : 'Y'}</div><div className="message-body">{message.stamp && <span className="message-stamp">{message.stamp}</span>}<p>{message.text}</p>{message.toolEvents?.length > 0 && <div className="tool-event-list" aria-label="Agent tools used">{message.toolEvents.map((tool, toolIndex) => <div className={`tool-event ${tool.status === 'error' ? 'tool-event-error' : ''}`} key={`${tool.name}-${toolIndex}`}><span className="tool-event-dot" /><span className="tool-event-name">{tool.name}</span><span className="tool-event-summary">{tool.summary}</span></div>)}</div>}</div></div>)}{busyAction === 'chat' && <div className="typing-indicator"><span /><span /><span /> <small>Checking the workflow…</small></div>}<div ref={chatEndRef} /></div><div className="suggestion-row"><button onClick={() => setChatInput('Check my washer warranty')}>Warranty check <Icon name="arrow" size={12} /></button><button onClick={() => setChatInput('What should I do about vibration?')}>Vibration help <Icon name="arrow" size={12} /></button></div><form className="chat-compose" onSubmit={sendMessage}><input aria-label="Ask FixForward Guide" placeholder="Tell me what’s going on…" value={chatInput} onChange={(event) => setChatInput(event.target.value)} /><button type="submit" aria-label="Send message" disabled={!chatInput.trim() || busyAction === 'chat'}><Icon name="send" size={17} /></button></form><div className="concierge-disclaimer"><Icon name="shield" size={13} /><span>Safety-first guidance. Simulated service data. You approve every booking.</span></div></section>

                <section className="next-up-card"><div className="next-up-heading"><span className="eyebrow">NEXT UP</span><Icon name="calendar" size={17} /></div>{currentCase?.status === 'scheduled' ? <><span className="next-up-date">{relativeDay(currentCase.starts_at)}</span><h3>Repair visit</h3><p>{currentCase.model || 'Home appliance'} · {formatTime(currentCase.starts_at)}</p><div className="next-up-person"><div className="technician-avatar">{(currentCase.technician_name || 'M')[0]}</div><span><strong>{currentCase.technician_name || 'Technician assigned'}</strong><small>Appointment booked</small></span><Icon name="checkCircle" size={18} className="next-up-check" /></div><button className="next-up-button" onClick={() => navigateTo('Appointments')}>View appointment <Icon name="arrow" size={15} /></button>{canRecover && <button className="simulate-link" onClick={simulateCancellation} disabled={busyAction === 'cancel'}><Icon name="refresh" size={14} /> {busyAction === 'cancel' ? 'Simulating…' : 'Simulate technician cancellation'}</button>}</> : currentCase?.status === 'needs_rescheduling' ? <><span className="next-up-date coral-text">Action needed</span><h3>Let's find a new time.</h3><p>Your case is still open. Pick an alternative visit slot to continue.</p><button className="next-up-button" onClick={() => { setPendingCaseId(currentCase.case_id); setShowSlotModal(true); }}>Find a replacement <Icon name="arrow" size={15} /></button></> : <><span className="next-up-date">No visit booked</span><h3>Make room for a fix.</h3><p>Open a repair case and find a time that fits your schedule.</p><button className="next-up-button" onClick={() => currentCase ? (setPendingCaseId(currentCase.case_id), setShowSlotModal(true)) : setShowCaseModal(true)}>{currentCase ? 'Choose a visit time' : 'Start a repair'} <Icon name="arrow" size={15} /></button></>}</section>

                <section className="trust-card"><div className="trust-card-icon"><Icon name="shield" size={20} /></div><div><strong>Permission before action.</strong><p>FixForward shows the exact slot and technician before booking. No silent commitments.</p></div><span className="trust-card-number">02</span></section>
              </aside>
            </div>
            <footer className="page-footer"><span>© {new Date().getFullYear()} FixForward AI</span><span><i /> A calmer way to fix things.</span><span className="footer-build">{connected ? 'API CONNECTED' : 'INTERACTIVE LOCAL PREVIEW'} · BUILD 0.2</span></footer>
          </div>
        )}
      </main>

      {showCaseModal && <Modal title="Let's get this sorted." description="Tell us what is happening with your WashPro 8kg. We’ll save the issue before suggesting a next step." onClose={() => setShowCaseModal(false)}><form className="case-form" onSubmit={submitNewCase}><label>Appliance in this demo<input value="WhirlNest WashPro 8kg washing machine" readOnly /></label><label>What have you noticed?<textarea value={issue} onChange={(event) => setIssue(event.target.value)} minLength={8} maxLength={1200} required placeholder="For example: loud rattling sound during the spin cycle…" rows={4} /></label><div className="form-help"><Icon name="shield" size={15} /><span>Do not include passwords or payment details. This creates a demo repair case only.</span></div><button className="primary-button full-button" type="submit" disabled={creatingCase}>{creatingCase ? 'Saving your case…' : 'Create repair case'} <Icon name="arrow" size={16} /></button></form></Modal>}

      {showSlotModal && <Modal title={pendingCaseId ? 'Find your next good time.' : 'Appointment availability'} description="Choose a slot to review. Nothing is booked until you confirm the exact time." onClose={() => { setShowSlotModal(false); setPendingSlot(null); }} wide><div className="slot-modal-meta"><span className="slot-meta-icon"><Icon name="shield" size={17} /></span><span><strong>{pendingCaseId || currentCase?.case_id || 'No case selected'}</strong><small>{cases.find((item) => item.case_id === (pendingCaseId || currentCase?.case_id))?.issue_description || 'Select an existing repair case first.'}</small></span><button className="text-action" onClick={refreshSlots}><Icon name="refresh" size={14} /> Refresh</button></div>{!pendingSlot ? <><div className="slot-list-heading"><span>AVAILABLE VISITS</span><span>{slots.filter((item) => item.status === 'available').length} slots</span></div><div className="slot-list">{slots.filter((slot) => slot.status === 'available').map((slot) => <button className="slot-option" key={slot.slot_id} onClick={() => chooseSlot(slot, pendingCaseId || currentCase?.case_id)}><span className="slot-date-block"><strong>{new Date(slot.starts_at).getDate()}</strong><small>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(slot.starts_at))}</small></span><span className="slot-info"><strong>{relativeDay(slot.starts_at)} · {formatTime(slot.starts_at)}</strong><small>{formatTime(slot.ends_at)} finish · 90-minute window</small></span><span className="slot-tech"><span className="technician-avatar small-tech">{(slot.technician_name || 'T')[0]}</span><span><strong>{slot.technician_name}</strong><small>Washer repair</small></span></span><span className="slot-arrow"><Icon name="chevron" size={17} /></span></button>)}</div>{!slots.some((slot) => slot.status === 'available') && <div className="slot-empty">No slots are currently available. Refresh to check again.</div>}</> : <div className="booking-confirmation"><button className="back-link" onClick={() => setPendingSlot(null)}><Icon name="arrow" size={14} className="back-arrow" /> Back to times</button><div className="booking-confirm-icon"><Icon name="calendar" size={25} /></div><span className="eyebrow">PLEASE REVIEW</span><h3>Confirm this visit?</h3><p>We’ll attach this appointment to the repair case shown below.</p><div className="confirmation-receipt"><div><span>REPAIR CASE</span><strong>{pendingCaseId}</strong></div><div><span>DATE & TIME</span><strong>{formatDate(pendingSlot.starts_at, { weekday: 'long', month: 'long', day: 'numeric' })}, {formatTime(pendingSlot.starts_at)}</strong></div><div><span>TECHNICIAN</span><strong>{pendingSlot.technician_name}</strong></div><div><span>APPOINTMENT WINDOW</span><strong>{formatTime(pendingSlot.starts_at)} – {formatTime(pendingSlot.ends_at)}</strong></div></div><div className="confirmation-disclaimer"><Icon name="info" size={16} /> This is a simulated appointment. No real service provider will be contacted.</div><button className="primary-button full-button" onClick={confirmBooking} disabled={busyAction === 'booking'}>{busyAction === 'booking' ? 'Confirming…' : 'Yes, confirm appointment'} <Icon name="check" size={16} /></button><button className="cancel-text-button" onClick={() => setPendingSlot(null)}>Not yet — choose another time</button></div>}</Modal>}

      {showApplianceModal && <Modal title="Your washing machine." description="Review the appliance profile and the stored demo warranty record." onClose={() => { setShowApplianceModal(false); setWarrantyInfo(null); }} wide>
        <div className="appliance-modal-list">
          {appliances.map((item) => {
            const itemWarranty = getWarrantyAssessment(item, selectedApplianceId === item.appliance_id ? warrantyInfo : null);
            return <button key={item.appliance_id} className={`appliance-modal-row ${selectedApplianceId === item.appliance_id ? 'is-selected' : ''}`} onClick={() => { setSelectedApplianceId(item.appliance_id); setWarrantyInfo(null); }}>
              <div className={`appliance-modal-icon ${item.appliance_type}`}><Icon name={applianceIcon(item.appliance_type)} size={20} /></div>
              <div><strong>{item.brand} {item.model}</strong><span>{applianceLabel(item.appliance_type)} · {item.location_label || 'Home'}</span></div>
              <span className={`warranty-tag ${itemWarranty.tone}`}>{itemWarranty.label}</span><Icon name="chevron" size={16} />
            </button>;
          })}
        </div>
        {selectedAppliance && <>
          <div className="appliance-detail-grid">
            <div><small>Appliance ID</small><strong>{selectedAppliance.appliance_id}</strong></div>
            <div><small>Brand / model</small><strong>{selectedAppliance.brand} {selectedAppliance.model}</strong></div>
            <div><small>Purchase date</small><strong>{selectedAppliance.purchase_date ? formatDate(selectedAppliance.purchase_date, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded'}</strong></div>
            <div><small>Listed warranty expiry</small><strong>{warrantyAssessment.expiry ? formatDate(warrantyAssessment.expiry, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded'}</strong></div>
            <div><small>Location</small><strong>{selectedAppliance.location_label || 'Home'}</strong></div>
            <div><small>Warranty record</small><strong>{warrantyAssessment.label}</strong></div>
          </div>
          <section className={`warranty-advice-card warranty-advice-${warrantyAssessment.tone} warranty-advice-modal`}>
            <div className="warranty-advice-kicker"><span><Icon name="shield" size={17} /></span><div><span className="eyebrow">RECOMMENDED NEXT STEP</span><small>{warrantyAssessment.timing}</small></div></div>
            <h3>{warrantyAssessment.headline}</h3><p>{warrantyAssessment.recommendation}</p>
          </section>
          <div className="appliance-modal-actions">
            <button className="secondary-button" onClick={() => handleWarrantyCheck(selectedAppliance.appliance_id)} disabled={warrantyLoading}><Icon name="shield" size={15} /> {warrantyLoading ? 'Refreshing…' : 'Refresh warranty record'}</button>
            <button className="secondary-button" onClick={() => { setIssue(`Please inspect my ${selectedAppliance.brand} ${selectedAppliance.model}.`); setShowApplianceModal(false); setShowCaseModal(true); }}><Icon name="plus" size={15} /> Start repair case</button>
            <button className="primary-button" onClick={() => { setShowApplianceModal(false); setChatInput('What should I do about heavy vibration during the spin cycle?'); setActiveView('Overview'); }}>Get troubleshooting help <Icon name="arrow" size={14} /></button>
          </div>
          {warrantyInfo && <div className="warranty-result"><strong>Saved warranty record retrieved</strong><span>Status: {warrantyAssessment.label}</span><span>Purchase date: {warrantyInfo.purchase_date || 'not recorded'}</span><span>Listed expiry: {warrantyInfo.warranty_expiry || 'not recorded'}</span><small>{warrantyInfo.note || 'Demo record only. Confirm coverage, exclusions and service requirements with the manufacturer.'}</small></div>}
        </>}
        <div className="form-help modal-footnote"><Icon name="info" size={15} /><span>All appliance and warranty details in this build are simulated. A successful lookup means the stored demo record was retrieved, not that the manufacturer confirmed coverage.</span></div>
      </Modal>}

      {showProfileModal && <Modal title="Workspace preferences." description="These preferences are stored locally in this browser for the demo." onClose={() => setShowProfileModal(false)}><form className="profile-settings-form" onSubmit={saveProfile}><label>Display name<input maxLength={50} value={profileDraft.displayName} onChange={(event) => setProfileDraft((previous) => ({ ...previous, displayName: event.target.value }))} placeholder="Homeowner" /></label><label>Home label<input maxLength={50} value={profileDraft.homeLabel} onChange={(event) => setProfileDraft((previous) => ({ ...previous, homeLabel: event.target.value }))} placeholder="My home" /></label><label className="preference-toggle"><span><strong>Appointment reminders</strong><small>Show upcoming visits and rescheduling alerts in this workspace. No email or push alert is sent.</small></span><input type="checkbox" checked={profileDraft.appointmentReminders} onChange={(event) => setProfileDraft((previous) => ({ ...previous, appointmentReminders: event.target.checked }))} /></label><label className="preference-toggle"><span><strong>Product updates</strong><small>Local preview preference only; no email is sent.</small></span><input type="checkbox" checked={profileDraft.productUpdates} onChange={(event) => setProfileDraft((previous) => ({ ...previous, productUpdates: event.target.checked }))} /></label><div className="form-help"><Icon name="info" size={15} /><span>No email or profile details are sent to a service. Preferences remain in browser storage.</span></div><button className="primary-button full-button" type="submit">Save preferences <Icon name="check" size={15} /></button></form></Modal>}

      {showNotificationsModal && <Modal title="Home repair notifications." description="Actionable reminders generated from the current demo workspace." onClose={() => setShowNotificationsModal(false)} wide>
        <div className="notification-modal-toolbar">
          <div><strong>{notificationItems.length ? `${notificationItems.length} ${notificationItems.length === 1 ? 'notification' : 'notifications'}` : 'You’re all caught up'}</strong><span>{unreadNotificationCount ? `${unreadNotificationCount} unread` : 'Everything in this list is read'}</span></div>
          {unreadNotificationCount > 0 && <button className="text-action" onClick={markAllNotificationsRead}>Mark all as read <Icon name="check" size={14} /></button>}
        </div>
        <div className="notification-list" aria-live="polite">
          {notificationItems.length ? notificationItems.map((item) => {
            const isRead = readNotificationIds.includes(item.id);
            return <article className={`notification-item notification-tone-${item.tone || 'info'} ${isRead ? 'notification-read' : 'notification-unread'}`} key={item.id}>
              <span className="notification-item-icon"><Icon name={item.icon || 'info'} size={17} /></span>
              <div className="notification-item-content">
                <div className="notification-item-heading"><strong>{item.title}</strong><span className={`notification-state ${isRead ? 'is-read' : 'is-unread'}`}>{isRead ? 'Read' : 'New'}</span></div>
                <p>{item.message}</p>
                {item.detail && <small>{item.detail}</small>}
                <div className="notification-item-actions">
                  <button className="text-action" onClick={() => handleNotificationAction(item)}>{item.actionLabel || 'Review'} <Icon name="arrow" size={14} /></button>
                  {!isRead && <button className="notification-mark-read" onClick={() => markNotificationRead(item.id)}>Mark read</button>}
                </div>
              </div>
            </article>;
          }) : <div className="notification-empty-state"><span><Icon name="checkCircle" size={22} /></span><strong>No current alerts</strong><p>There are no active case reminders right now. New case or appointment states will appear here as the demo workspace changes.</p><button className="secondary-button" onClick={() => { setShowNotificationsModal(false); setActiveView('Repair cases'); }}>Review repair cases <Icon name="arrow" size={14} /></button></div>}
        </div>
        <div className="notification-disclaimer"><Icon name="info" size={15} /><span>These are in-app demo notifications. Read status is saved in this browser. This build does not send email, SMS, or push notifications.</span></div>
        <button className="secondary-button full-button" onClick={() => { setShowNotificationsModal(false); setActiveView(currentCase ? 'Repair cases' : 'Overview'); if (currentCase) setCurrentCaseId(currentCase.case_id); }}>Review selected repair case <Icon name="arrow" size={14} /></button>
      </Modal>}

      {pendingSlot && !showSlotModal && <Modal title="Confirm appointment" onClose={() => setPendingSlot(null)}><p>This visit is for {pendingCaseId}. Confirm the time to save a demo booking.</p><button className="primary-button full-button" onClick={confirmBooking}>Confirm appointment</button></Modal>}
      {toast && <div className={`toast toast-${toast.type}`} role="status"><span className="toast-icon"><Icon name={toast.type === 'error' ? 'alert' : toast.type === 'info' ? 'info' : 'checkCircle'} size={17} /></span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}
    </div>
  );
}

function StatCard({ icon, label, value, note, tone }) {
  return <article className="stat-card"><div className={`stat-icon stat-${tone}`}><Icon name={icon} size={18} /></div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div><span className={`stat-accent accent-${tone}`} /></article>;
}

function ApplianceCard({ appliance, index, selected, onClick }) {
  const warranty = getWarrantyAssessment(appliance);
  return <button className={`appliance-card ${selected ? 'appliance-selected' : ''}`} onClick={onClick}><div className="appliance-card-top"><span className={`appliance-mini-icon appliance-tone-${index}`}><Icon name={applianceIcon(appliance.appliance_type)} size={18} /></span><span className={`warranty-tag ${warranty.tone}`}><span />{warranty.label}</span></div><div className={`appliance-card-art art-${index}`}><ApplianceArt type={appliance.appliance_type} /></div><div className="appliance-card-details"><span>{applianceLabel(appliance.appliance_type)}</span><strong>{appliance.model}</strong><small>{appliance.location_label || 'My home'}</small></div><span className="appliance-card-arrow"><Icon name="arrow" size={15} /></span></button>;
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
