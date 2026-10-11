import { useEffect, useState } from 'react';

export function PhotoConfirmation({ file, path }: { file: File; path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return <figure><img src={url} alt={path} /><figcaption>{path} · {Math.round(file.size / 1024)} KB</figcaption></figure>;
}
