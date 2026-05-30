'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Plus, Eye, EyeOff, Trash2, ImagePlus } from 'lucide-react';

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;
const STORAGE_KEY = 'gridded:images';

// Individual draggable tile
function SortableTile({ image, isPreviewMode, onDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id, disabled: isPreviewMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 'auto',
    aspectRatio: '3/4',
    touchAction: 'none', // prevent page-pan during drag on mobile
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isPreviewMode ? {} : listeners)}
      className="relative overflow-hidden select-none"
    >
      <img
        src={image.src}
        alt={image.name}
        className="w-full h-full object-cover pointer-events-none"
        draggable={false}
      />
      {!isPreviewMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(image.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 active:scale-90 transition-all touch-manipulation"
          aria-label="Delete image"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export default function InstagramGridPreview() {
  const [images, setImages] = useState([]);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const fileInputRef = useRef(null);

  // Sensors for dnd-kit: mouse, touch, and keyboard all supported
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      // Long-press for 200ms to start drag on touch devices
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load saved grid from localStorage on first mount (client-side only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setImages(parsed);
      }
    } catch (e) {
      console.error('Failed to load saved grid', e);
    }
    setIsHydrated(true);
  }, []);

  // Save to localStorage on every change (after initial hydration)
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(images));
      setStorageWarning(false);
    } catch (e) {
      console.error('Failed to save grid (storage full?)', e);
      setStorageWarning(true);
    }
  }, [images, isHydrated]);

  // Crops + resizes an uploaded image to 1080x1350 (3:4) using canvas.
  // Uses URL.createObjectURL instead of FileReader — handles large iPhone
  // photos far more reliably (no giant base64 strings in memory).
  const processFile = useCallback((file) => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error(`Not an image: ${file.name} (${file.type || 'unknown type'})`));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = TARGET_WIDTH;
          canvas.height = TARGET_HEIGHT;
          const ctx = canvas.getContext('2d');
          const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
          const sourceRatio = img.width / img.height;
          let sx, sy, sWidth, sHeight;
          if (sourceRatio > targetRatio) {
            sHeight = img.height;
            sWidth = sHeight * targetRatio;
            sx = (img.width - sWidth) / 2;
            sy = 0;
          } else {
            sWidth = img.width;
            sHeight = sWidth / targetRatio;
            sx = 0;
            sy = (img.height - sHeight) / 2;
          }
          ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(objectUrl);
          resolve({
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            src: dataUrl,
            name: file.name,
          });
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Canvas error: ${err.message}`));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Couldn't decode image: ${file.name} (${file.type || 'unknown'}). HEIC images may need to be converted to JPEG.`));
      };
      img.src = objectUrl;
    });
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    setErrorMessage(null);
    const allFiles = Array.from(fileList);
    if (allFiles.length === 0) {
      setErrorMessage('No files selected.');
      return;
    }
    const files = allFiles.filter(f => f.type.startsWith('image/'));
    if (files.length === 0) {
      setErrorMessage(`No images found. Got: ${allFiles.map(f => f.type || 'unknown').join(', ')}`);
      return;
    }
    setIsProcessing(true);
    try {
      const processed = await Promise.all(files.map(processFile));
      setImages(prev => [...processed, ...prev]);
    } catch (err) {
      console.error('Image processing failed', err);
      setErrorMessage(err.message || 'Image processing failed');
    } finally {
      setIsProcessing(false);
    }
  }, [processFile]);

  const handleFileInput = (e) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    } else {
      setErrorMessage('Upload event fired but no file list. iOS may be blocking — try a different photo or browser.');
    }
    e.target.value = '';
  };

  // File-drop zone handlers (desktop only — mobile uses tap)
  const handleDropZoneDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDraggingFile(true);
  };
  const handleDropZoneDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDraggingFile(false);
  };
  const handleDropZoneDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // dnd-kit reorder
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setImages((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const deleteImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const clearAll = () => {
    if (window.confirm('Clear all images? This cannot be undone.')) setImages([]);
  };

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <div className="min-h-screen w-full" style={{
        fontFamily: '"DM Sans", system-ui, sans-serif',
        backgroundColor: '#F5F1EA',
        color: '#1A1814',
        backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(193, 102, 65, 0.04) 0%, transparent 50%), radial-gradient(circle at 80% 100%, rgba(193, 102, 65, 0.03) 0%, transparent 50%)',
      }}>
        {/* Header */}
        <header className="border-b border-stone-300/60 px-4 sm:px-6 py-4 sm:py-5">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 'clamp(1.5rem, 5vw, 1.75rem)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}>
                Gridded<span style={{ color: '#C16641' }}>.</span>
              </h1>
              <span className="text-[10px] sm:text-xs uppercase tracking-widest text-stone-500 hidden sm:inline">
                Instagram feed preview
              </span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {images.length > 0 && (
                <>
                  <button
                    onClick={() => setIsPreviewMode(p => !p)}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs uppercase tracking-wider rounded-full transition-colors hover:bg-stone-200/60 active:scale-95"
                    style={{ color: '#1A1814' }}
                  >
                    {isPreviewMode ? <EyeOff size={14} /> : <Eye size={14} />}
                    <span className="hidden xs:inline sm:inline">{isPreviewMode ? 'Edit' : 'Preview'}</span>
                  </button>
                  <button
                    onClick={clearAll}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs uppercase tracking-wider rounded-full transition-colors hover:bg-red-50 hover:text-red-700 active:scale-95"
                    aria-label="Clear all images"
                  >
                    <Trash2 size={14} />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* Profile mockup */}
          <section className="mb-6 sm:mb-8">
            <div className="flex items-start gap-4 sm:gap-8">
              <div
                className="w-16 h-16 sm:w-24 sm:h-24 rounded-full flex-shrink-0 flex items-center justify-center text-white font-medium"
                style={{
                  background: 'linear-gradient(135deg, #C16641 0%, #8B3A1F 100%)',
                  fontFamily: '"Fraunces", serif',
                  fontSize: 'clamp(1.1rem, 4vw, 1.5rem)',
                }}
              >
                YOU
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-4 mb-2 sm:mb-3">
                  <p className="text-sm font-medium">your_handle</p>
                </div>
                <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm mb-2 sm:mb-3">
                  <div><span className="font-semibold">{images.length}</span> <span className="text-stone-500">posts</span></div>
                  <div><span className="font-semibold">—</span> <span className="text-stone-500">followers</span></div>
                  <div><span className="font-semibold">—</span> <span className="text-stone-500">following</span></div>
                </div>
                <p className="text-xs sm:text-sm text-stone-600 leading-snug">
                  Your bio goes here.<br />
                  <span className="text-stone-400">A preview of how your grid looks.</span>
                </p>
              </div>
            </div>
          </section>

          <div className="border-t border-stone-300/60 mb-1"></div>

          {/* Storage warning */}
          {storageWarning && (
            <div className="mb-3 p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded">
              Storage is full — delete some images before adding more.
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div className="mb-3 p-3 text-xs text-red-900 bg-red-50 border border-red-200 rounded flex items-start gap-2">
              <span className="flex-1 break-words">{errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="flex-shrink-0 text-red-700 hover:text-red-900"
                aria-label="Dismiss error"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Grid */}
          {images.length > 0 ? (
            <section
              onDragOver={handleDropZoneDragOver}
              onDragLeave={handleDropZoneDragLeave}
              onDrop={handleDropZoneDrop}
              className="relative"
            >
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={images.map(i => i.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-3" style={{ gap: '3px' }}>
                    {images.map((img) => (
                      <SortableTile
                        key={img.id}
                        image={img}
                        isPreviewMode={isPreviewMode}
                        onDelete={deleteImage}
                      />
                    ))}
                    {!isPreviewMode && (
                      <label
                        htmlFor="file-upload-input"
                        className="flex flex-col items-center justify-center bg-stone-200/50 hover:bg-stone-200 active:bg-stone-300 transition-colors border border-dashed border-stone-400/60 touch-manipulation cursor-pointer"
                        style={{ aspectRatio: '3/4' }}
                        aria-label="Add more images"
                      >
                        <Plus size={28} strokeWidth={1.5} className="text-stone-500" />
                        <span className="text-[10px] uppercase tracking-widest text-stone-500 mt-1">Add</span>
                      </label>
                    )}
                  </div>
                </SortableContext>
              </DndContext>

              {isDraggingFile && (
                <div
                  className="absolute inset-0 flex items-center justify-center backdrop-blur-sm pointer-events-none"
                  style={{ backgroundColor: 'rgba(245, 241, 234, 0.85)', border: '2px dashed #C16641' }}
                >
                  <p
                    className="text-lg"
                    style={{ fontFamily: '"Fraunces", serif', color: '#C16641' }}
                  >
                    Drop to add to your grid
                  </p>
                </div>
              )}
            </section>
          ) : (
            <label
              htmlFor="file-upload-input"
              onDragOver={handleDropZoneDragOver}
              onDragLeave={handleDropZoneDragLeave}
              onDrop={handleDropZoneDrop}
              className="block cursor-pointer transition-all touch-manipulation"
              style={{
                marginTop: '2rem',
                padding: '3rem 1.5rem',
                border: `2px dashed ${isDraggingFile ? '#C16641' : 'rgba(120, 113, 100, 0.4)'}`,
                backgroundColor: isDraggingFile ? 'rgba(193, 102, 65, 0.05)' : 'transparent',
                borderRadius: '4px',
                textAlign: 'center',
              }}
            >
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-5" style={{ backgroundColor: 'rgba(193, 102, 65, 0.1)' }}>
                <ImagePlus size={24} style={{ color: '#C16641' }} strokeWidth={1.5} />
              </div>
              <h2 style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 'clamp(1.25rem, 5vw, 1.5rem)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                marginBottom: '0.5rem',
              }}>
                Start building your grid
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 mb-1">
                <span className="hidden sm:inline">Drop images here or </span>
                <span className="sm:hidden">Tap to upload</span>
                <span className="hidden sm:inline">click to upload</span>
              </p>
              <p className="text-[10px] sm:text-xs text-stone-500">
                Auto-cropped to 1080 × 1350 (3:4 portrait)
              </p>
            </label>
          )}

          {isProcessing && (
            <p className="text-center text-sm text-stone-500 mt-6 animate-pulse">
              Processing images…
            </p>
          )}

          {/* iOS Chrome help — collapsed by default, available when needed */}
          <details className="mt-6 group">
            <summary className="text-center text-[10px] sm:text-xs text-stone-500 cursor-pointer hover:text-stone-700 select-none list-none uppercase tracking-widest">
              <span className="group-open:hidden">Upload not working on iPhone?</span>
              <span className="hidden group-open:inline">Hide help</span>
            </summary>
            <div className="mt-3 max-w-md mx-auto p-4 bg-white/60 border border-stone-200 rounded text-stone-700 text-xs sm:text-sm leading-relaxed">
              <p className="mb-2">
                <strong>If you&rsquo;re on iPhone and photos won&rsquo;t upload:</strong> iOS limits what photos your browser can access by default.
              </p>
              <p className="mb-2">To fix it:</p>
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>Open <strong>Settings</strong> on your iPhone</li>
                <li>Scroll down and tap <strong>Chrome</strong> (or whichever browser you&rsquo;re using)</li>
                <li>Tap <strong>Photos</strong></li>
                <li>Choose <strong>&ldquo;All Photos&rdquo;</strong></li>
              </ol>
              <p className="mt-2 text-stone-500">
                Return to this page and try again.
              </p>
            </div>
          </details>

          {images.length > 0 && !isPreviewMode && (
            <p className="text-center text-[10px] sm:text-xs text-stone-500 mt-6 uppercase tracking-widest">
              <span className="hidden sm:inline">Drag tiles to rearrange · Tap × to delete</span>
              <span className="sm:hidden">Long-press a tile to drag · Tap × to delete</span>
            </p>
          )}
        </main>

        <input
          ref={fileInputRef}
          id="file-upload-input"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        />

        <footer className="text-center py-6 sm:py-8 text-[10px] sm:text-xs text-stone-400 uppercase tracking-widest px-4">
          Saved locally · Your images never leave this browser
        </footer>
      </div>
    </>
  );
}
