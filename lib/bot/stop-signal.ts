// In-memory stop signals — bot polls this to know when to leave
const stopSignals = new Set<string>();

export function requestStop(meetingId: string) {
  stopSignals.add(meetingId);
}

export function shouldStop(meetingId: string) {
  return stopSignals.has(meetingId);
}

export function clearStop(meetingId: string) {
  stopSignals.delete(meetingId);
}
