import { useState } from 'react';
import {
  RESOURCE_STATUS,
  RESOURCE_TYPES,
  type CreateReportInput,
  type ResourceStatus,
  type ResourceType,
} from '@derf/shared';
import { createReport } from '../lib/api';

interface ReportFormProps {
  location: { lat: number; lon: number } | null;
  onStartPicking: () => void;
  onSubmitted: () => void;
}

export function ReportForm({ location, onStartPicking, onSubmitted }: ReportFormProps) {
  const [resourceType, setResourceType] = useState<ResourceType>('shelter');
  const [status, setStatus] = useState<ResourceStatus>('available');
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState('');
  const [maximum, setMaximum] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showCapacity = resourceType === 'shelter';

  async function handle(event: React.FormEvent) {
    event.preventDefault();
    if (!location) {
      setError('Choose a location on the map first.');
      return;
    }
    setError(null);
    setBusy(true);

    const input: CreateReportInput = {
      resourceType,
      status,
      location,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(showCapacity && current && maximum
        ? { capacity: { current: Number(current), maximum: Number(maximum) } }
        : {}),
    };

    try {
      await createReport(input);
      setNote('');
      setCurrent('');
      setMaximum('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={handle}>
      <h2>Report a resource</h2>

      <label>
        Resource
        <select
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as ResourceType)}
        >
          {RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="statuses">
        <legend>Status</legend>
        {RESOURCE_STATUS.map((value) => (
          <label key={value} className="radio">
            <input
              type="radio"
              name="status"
              value={value}
              checked={status === value}
              onChange={() => setStatus(value)}
            />
            <span>{value}</span>
          </label>
        ))}
      </fieldset>

      {showCapacity && (
        <div className="capacity">
          <label>
            People now
            <input
              type="number"
              min="0"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            Capacity
            <input
              type="number"
              min="1"
              value={maximum}
              onChange={(e) => setMaximum(e.target.value)}
            />
          </label>
        </div>
      )}

      <label>
        Note
        <textarea
          value={note}
          maxLength={500}
          rows={2}
          placeholder="Queue is about an hour"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="location">
        {location ? (
          <span>
            {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          </span>
        ) : (
          <span className="hint">No location chosen</span>
        )}
        <button type="button" className="link" onClick={onStartPicking}>
          {location ? 'Change' : 'Pick on map'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy || !location}>
        {busy ? 'Submitting…' : 'Submit report'}
      </button>
    </form>
  );
}
