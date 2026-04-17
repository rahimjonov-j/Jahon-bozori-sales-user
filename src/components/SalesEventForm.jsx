import { useState } from 'react';

const exampleMessages = [
  'A-3-110 sotildi',
  'A blok 2 qavat 218 bron qilindi',
  "A 10 204 sotuv bo'ldi",
];

export default function SalesEventForm({ onSubmit }) {
  const [rawText, setRawText] = useState(exampleMessages[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [resultPayload, setResultPayload] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setResultMessage('');

    try {
      const result = await onSubmit(rawText);
      setResultPayload(result);
      setResultMessage('Parsed and applied successfully.');
    } catch (error) {
      setResultPayload(null);
      setResultMessage(error instanceof Error ? error.message : 'Unable to process the sales text.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="panel-heading__eyebrow">Mock Parser</p>
        <h2 className="panel-heading__title">Sales textni lokal parse qilish</h2>
      </div>

      <form className="sales-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="sales-text">
          Raw sales text
        </label>
        <textarea
          id="sales-text"
          className="sales-textarea"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          rows={5}
          placeholder="A-5-112 sotildi"
        />

        <div className="example-row">
          {exampleMessages.map((example) => (
            <button
              key={example}
              type="button"
              className="chip-button"
              onClick={() => setRawText(example)}
            >
              {example}
            </button>
          ))}
        </div>

        <button
          type="submit"
          className="primary-button"
          disabled={isSubmitting || !rawText.trim()}
        >
          {isSubmitting ? 'Applying...' : 'Parse and apply'}
        </button>
      </form>

      {resultMessage ? <p className="panel-note">{resultMessage}</p> : null}

      {resultPayload?.parsed ? (
        <pre className="json-preview">
          {JSON.stringify(resultPayload.parsed, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
