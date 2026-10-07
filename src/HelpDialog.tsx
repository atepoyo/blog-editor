import { messages } from './messages';
import type { Language } from './messages';
import { Modal } from './Modal';

export function HelpDialog({ language, onClose }: { language: Language; onClose: () => void }) {
  const text = messages[language];
  return (
    <Modal title={text.help} closeLabel={text.close} onClose={onClose}>
      <div className="help-content">
        <section><h3>{text.helpWrite}</h3><p>{text.helpWriteBody}</p></section>
        <section><h3>{text.helpPhoto}</h3><p>{text.helpPhotoBody}</p></section>
        <section><h3>{text.helpExport}</h3><p>{text.helpExportBody}</p></section>
        <section>
          <h3>{text.helpSettings}</h3>
          <dl className="help-settings">
            <div>
              <dt>{text.publicUrl}</dt>
              <dd><code>https://img.example.com/</code><p>{text.helpPublicUrl}</p><p>{text.helpImagePath}</p></dd>
            </div>
            <div>
              <dt>{text.workerUrl}</dt>
              <dd><code>https://app.me.workers.dev/posts</code><p>{text.helpWorkerUrl}</p></dd>
            </div>
          </dl>
        </section>
      </div>
    </Modal>
  );
}
