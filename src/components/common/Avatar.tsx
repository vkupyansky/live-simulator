import { initials } from '@/shared/lib/text';

export function Avatar({
  dataUrl,
  name,
  size = 44,
}: {
  dataUrl: string;
  name: string;
  size?: number;
}) {
  if (dataUrl)
    return <img className="avatar" src={dataUrl} alt="" style={{ width: size, height: size }} />;
  return (
    <span
      className="avatar avatar-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {initials(name)}
    </span>
  );
}
