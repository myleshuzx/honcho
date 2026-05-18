export function JsonPanel({ value }: { value: unknown }) {
  return (
    <pre
      className="card"
      style={{
        padding: 16,
        overflow: "auto",
        maxHeight: 520,
        fontSize: 12,
        lineHeight: 1.5
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
