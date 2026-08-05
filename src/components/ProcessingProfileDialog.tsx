import { Plus, Trash2, X } from 'lucide-react'
import { useEditor } from '../store/editor'

export function ProcessingProfileDialog({ onClose }: { onClose: () => void }) {
  const profiles = useEditor((state) => state.processingProfiles)
  const addProfile = useEditor((state) => state.addProcessingProfile)
  const updateProfile = useEditor((state) => state.updateProcessingProfile)
  const removeProfile = useEditor((state) => state.removeProcessingProfile)

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <header>
          <div>
            <h2 id="profile-dialog-title">Bearbeitungsprofile</h2>
            <p>
              Lege fest, was du am Objekt tun möchtest. Laserwerte werden später
              für Laser und Material eingerichtet.
            </p>
          </div>
          <button
            className="modal-close"
            type="button"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="profile-dialog-list">
          {[...profiles]
            .sort((a, b) => a.order - b.order)
            .map((profile) => (
              <article className="profile-definition" key={profile.id}>
                <input
                  className="profile-definition-color"
                  type="color"
                  aria-label="Kennfarbe"
                  value={profile.color}
                  onChange={(event) =>
                    updateProfile(profile.id, { color: event.target.value })
                  }
                />
                <label className="profile-definition-name">
                  <span>Name</span>
                  <input
                    value={profile.name}
                    onChange={(event) =>
                      updateProfile(profile.id, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Anwendung</span>
                  <select
                    value={profile.geometry}
                    onChange={(event) =>
                      updateProfile(profile.id, {
                        geometry: event.target.value as 'fill' | 'contour',
                      })
                    }
                  >
                    <option value="fill">Fläche</option>
                    <option value="contour">Kontur</option>
                  </select>
                </label>
                <label>
                  <span>Referenztiefe</span>
                  <div className="profile-depth">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={profile.referenceDepth ?? ''}
                      placeholder="optional"
                      onChange={(event) =>
                        updateProfile(profile.id, {
                          referenceDepth:
                            event.target.value === ''
                              ? undefined
                              : Math.max(0, Number(event.target.value)),
                        })
                      }
                    />
                    <em>mm</em>
                  </div>
                </label>
                <button
                  className="profile-delete"
                  type="button"
                  title="Profil löschen"
                  onClick={() => removeProfile(profile.id)}
                >
                  <Trash2 />
                </button>
              </article>
            ))}
        </div>
        <footer>
          <button
            className="add-profile-button"
            type="button"
            onClick={() =>
              addProfile({
                name: 'Neues Bearbeitungsprofil',
                geometry: 'contour',
                color: '#d000d0',
              })
            }
          >
            <Plus />
            Profil anlegen
          </button>
          <button className="primary" type="button" onClick={onClose}>
            Fertig
          </button>
        </footer>
      </section>
    </div>
  )
}
