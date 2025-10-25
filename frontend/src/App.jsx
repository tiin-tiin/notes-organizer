import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, RefreshCw, GripVertical } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const API_URL = 'http://localhost:8000';

// Draggable Note component
function SortableNoteItem({ 
    note, 
    index,
    clusterTitle, 
    onEdit, 
    onDelete, 
    isEditing, 
    onSave, 
    onCancel, 
    onTextChange, 
    editedText 
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: `${clusterTitle}::${index}`, // Simple unique ID
        data: {
            noteText: note,
            clusterTitle: clusterTitle,
            index: index
        }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`bg-orange-50 p-3 rounded-lg border border-orange-200 group hover:bg-orange-100 transition-colors ${isDragging ? 'shadow-lg' : ''}`}
        >
            {isEditing ? (
                <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                        value={editedText}
                        onChange={(e) => onTextChange(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-orange-300 rounded focus:outline-none focus:border-orange-500 text-gray-800"
                        rows="3"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={onSave}
                            className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm flex items-center gap-1"
                        >
                            <Save className="w-3 h-3" />
                            Save
                        </button>
                        <button
                            onClick={onCancel}
                            className="px-3 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm flex items-center gap-1"
                        >
                            <X className="w-3 h-3" />
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-start gap-2">
                    {/* Drag Handle - ONLY this part is draggable */}
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing pt-1 flex-shrink-0"
                    >
                        <GripVertical className="w-4 h-4 text-gray-400" />
                    </div>
                    
                    {/* Note text - NOT draggable, can select text */}
                    <p className="text-gray-700 flex-1 leading-relaxed break-all">{note}</p>
                    
                    {/* Action buttons - NOT draggable */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit();
                            }}
                            className="p-1 text-orange-600 hover:bg-orange-200 rounded"
                        >
                            <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            className="p-1 text-red-500 hover:bg-red-100 rounded"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Droppable cluster container
function DroppableCluster({ children, id }) {
    const { setNodeRef } = useSortable({
        id: id,
        data: { type: 'container', clusterTitle: id }
    });

    return (
        <div ref={setNodeRef} className="p-4 space-y-3 min-h-[200px] flex-1 overflow-y-auto bg-white">
            {children}
        </div>
    );
}

export default function NotesOrganizer() {
    const [clusters, setClusters] = useState([]);
    const [newNote, setNewNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [editingCluster, setEditingCluster] = useState(null);
    const [editedTitle, setEditedTitle] = useState('');
    const [editingNote, setEditingNote] = useState({ clusterTitle: null, noteText: null });
    const [editedNoteText, setEditedNoteText] = useState('');
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Drag starts after 8px movement
            },
        })
    );

    useEffect(() => {
        fetchClusters();
    }, []);

    const fetchClusters = async () => {
        try {
            const response = await fetch(`${API_URL}/clusters`);
            const data = await response.json();
            setClusters(data);
        } catch (error) {
            console.error('Error fetching clusters:', error);
        }
    };

    const addNote = async () => {
        if (!newNote.trim()) return;
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/add_note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_text: newNote })
            });
            if (response.ok) {
                setNewNote('');
                await fetchClusters();
            }
        } catch (error) {
            console.error('Error adding note:', error);
        }
        setLoading(false);
    };

    const createCluster = async () => {
        const title = window.prompt("Enter a new cluster title:");
        if (!title || !title.trim()) return;
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/create_cluster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_title: title.trim() })
            });
            if (response.ok) {
                await fetchClusters();
            } else {
                const err = await response.json();
                alert(`Error: ${err.detail}`);
            }
        } catch (error) {
            console.error('Error creating cluster:', error);
        }
        setLoading(false);
    };

    const deleteCluster = async (clusterTitle) => {
        // Confirm before deleting
        const confirmed = window.confirm(
            `Are you sure you want to delete the cluster "${clusterTitle}"?\n\n` +
            `This will delete the cluster and all ${clusters.find(c => c.cluster_title === clusterTitle)?.notes.length || 0} notes inside it.`
        );
        
        if (!confirmed) return;
        
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/delete_cluster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cluster_title: clusterTitle })
            });
            
            if (response.ok) {
                await fetchClusters();
            } else {
                const err = await response.json();
                alert(`Error: ${err.detail}`);
            }
        } catch (error) {
            console.error('Error deleting cluster:', error);
            alert('Failed to delete cluster. Please try again.');
        }
        setLoading(false);
    };

    const deleteNote = async (clusterTitle, noteToDelete) => {
        
        // --- CORRECTED CONFIRMATION LOGIC ---
        const confirmed = window.confirm(
            `Are you sure you want to delete this note from the "${clusterTitle}" cluster?\n\n` +
            `Note: "${noteToDelete}"`
        );
        
        if (!confirmed) return;
        // ------------------------------------

        try {
            const response = await fetch(`${API_URL}/edit_cluster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cluster_title: clusterTitle,
                    notes_to_delete: [noteToDelete]
                })
            });
            
            if (response.ok) {
                // Check if the cluster might have been deleted (if it was the last note)
                // The backend handles cluster deletion if notes become empty.
                await fetchClusters();
            } else {
                // Add error handling for note deletion
                const err = await response.json();
                alert(`Error deleting note: ${err.detail}`);
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            alert('Failed to delete note. Please check the backend server.');
        }
    };



    const startEditingTitle = (cluster) => {
        setEditingCluster(cluster.cluster_title);
        setEditedTitle(cluster.cluster_title);
    };

    const saveClusterTitle = async (oldTitle) => {
        if (!editedTitle.trim()) {
            alert("Title cannot be empty");
            return;
        }
        try {
            const response = await fetch(`${API_URL}/edit_cluster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cluster_title: oldTitle,
                    new_title: editedTitle.trim()
                })
            });
            if (response.ok) {
                setEditingCluster(null);
                await fetchClusters();
            } else {
                const err = await response.json();
                alert(`Error: ${err.detail}`);
            }
        } catch (error) {
            console.error('Error updating title:', error);
        }
    };

    const startEditingNote = (clusterTitle, noteText) => {
        setEditingNote({ clusterTitle, noteText });
        setEditedNoteText(noteText);
    };

    const saveNote = async () => {
        if (!editedNoteText.trim()) {
            alert("Note cannot be empty");
            return;
        }
        try {
            const response = await fetch(`${API_URL}/edit_cluster`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cluster_title: editingNote.clusterTitle,
                    note_to_edit: editingNote.noteText,
                    new_note_text: editedNoteText.trim()
                })
            });
            if (response.ok) {
                setEditingNote({ clusterTitle: null, noteText: null });
                await fetchClusters();
            }
        } catch (error) {
            console.error('Error updating note:', error);
        }
    };

    const moveNote = async (sourceClusterTitle, noteToMove, destClusterTitle) => {
        if (sourceClusterTitle === destClusterTitle) return;
        
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/move_note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_cluster_title: sourceClusterTitle,
                    note_to_move: noteToMove,
                    dest_cluster_title: destClusterTitle
                })
            });
            if (response.ok) {
                await fetchClusters();
            } else {
                const err = await response.json();
                alert(`Error: ${err.detail}`);
            }
        } catch (error) {
            console.error('Error moving note:', error);
        }
        setLoading(false);
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        // Get source info from active
        const sourceData = active.data.current;
        if (!sourceData) return;

        const { noteText, clusterTitle: sourceClusterTitle } = sourceData;

        // Get destination cluster
        let destClusterTitle;
        
        // Check if dropped over a container
        if (over.data.current?.type === 'container') {
            destClusterTitle = over.data.current.clusterTitle;
        }
        // Or dropped over another note
        else if (over.data.current?.clusterTitle) {
            destClusterTitle = over.data.current.clusterTitle;
        }
        // Or dropped over a sortable context
        else {
            // Try to extract from over.id
            destClusterTitle = over.id;
        }

        console.log('Drag end:', { sourceClusterTitle, destClusterTitle, noteText });

        if (destClusterTitle && sourceClusterTitle !== destClusterTitle) {
            moveNote(sourceClusterTitle, noteText, destClusterTitle);
        }
    };

    // Get all sortable item IDs for DndContext
    const allItemIds = clusters.flatMap((cluster) =>
        cluster.notes.map((note, idx) => `${cluster.cluster_title}::${idx}`)
    ).concat(clusters.map(c => c.cluster_title)); // Include cluster titles as droppable areas

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-100 p-8">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <h1
                            className="text-5xl font-bold text-orange-600 mb-2 title-font"
                            style={{ fontFamily: '"League Spartan", sans-serif' }}>
                            NoteNext
                        </h1>
                        <p className="text-orange-700" style={{ fontFamily: '"B612 Mono", sans-serif' }}>Where your notes find their place</p>
                    </div>

                    {/* Add Note Section */}
                    <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border-2 border-orange-200">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && addNote()}
                                placeholder="Write your note here..."
                                className="flex-1 px-4 py-3 border-2 border-orange-300 rounded-lg focus:outline-none focus:border-orange-500 text-gray-800"
                            />
                            <button
                                onClick={addNote}
                                disabled={loading || !newNote.trim()}
                                className="px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold transition-colors"
                            >
                                {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                Add Note
                            </button>
                        </div>
                    </div>

                    {/* Manual Controls */}
                    <div className="flex justify-center mb-8 gap-4 flex-wrap">
                        <button
                            onClick={createCluster}
                            className="px-6 py-3 bg-white border-2 border-orange-500 text-orange-600 rounded-full hover:bg-orange-50 flex items-center gap-2 font-semibold shadow-lg transition-all transform hover:scale-105"
                        >
                            <Plus className="w-5 h-5" />
                            Create Cluster
                        </button>
                        <button
                            onClick={fetchClusters}
                            className="px-6 py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-full hover:from-orange-600 hover:to-amber-600 flex items-center gap-2 font-semibold shadow-lg transition-all transform hover:scale-105"
                        >
                            <RefreshCw className="w-5 h-5" />
                            Refresh
                        </button>
                    </div>

                    {/* Clusters Grid */}
                    {clusters.length === 0 ? (
                        <div className="text-center py-16 text-orange-600">
                            <p className="text-xl">No notes yet! Add a note or create a cluster.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {clusters.map((cluster) => (
                                <SortableContext
                                    key={cluster.cluster_title}
                                    id={cluster.cluster_title}
                                    items={cluster.notes.map((note, idx) => `${cluster.cluster_title}::${idx}`)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="bg-white rounded-xl shadow-lg border-2 border-orange-200 overflow-hidden hover:shadow-xl transition-shadow flex flex-col">
                                        {/* Cluster Header */}
                                        
                                        <div className="bg-gradient-to-r from-orange-400 to-amber-400 p-4 group" style={{ fontFamily: '"League Spartan", sans-serif' }}>
                                            {editingCluster === cluster.cluster_title ? (
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={editedTitle}
                                                        onChange={(e) => setEditedTitle(e.target.value)}
                                                        onKeyPress={(e) => {
                                                            if (e.key === 'Enter') saveClusterTitle(cluster.cluster_title);
                                                            if (e.key === 'Escape') setEditingCluster(null);
                                                        }}
                                                        className="flex-1 px-3 py-1 rounded border-2 border-white focus:outline-none text-gray-800"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => saveClusterTitle(cluster.cluster_title)}
                                                        className="p-2 bg-white text-orange-600 rounded hover:bg-orange-50"
                                                        title="Save"
                                                    >
                                                        <Save className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingCluster(null)}
                                                        className="p-2 bg-white text-orange-600 rounded hover:bg-orange-50"
                                                        title="Cancel"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div className="flex items-center justify-between">
                                                        <h2 className="text-xl font-bold text-white break-all">
                                                            {cluster.cluster_title}
                                                        </h2>
                                                        {/* Edit & Delete buttons - visible on hover */}
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button
                                                                onClick={() => startEditingTitle(cluster)}
                                                                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                                                                title="Edit cluster title"
                                                            >
                                                                <Edit2 className="w-4 h-4 text-white" />
                                                            </button>
                                                            <button
                                                                onClick={() => deleteCluster(cluster.cluster_title)}
                                                                className="p-2 bg-white/20 hover:bg-red-500/80 rounded-lg transition-colors"
                                                                title="Delete cluster"
                                                            >
                                                                <Trash2 className="w-4 h-4 text-white" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <p className="text-orange-50 text-sm mt-1">
                                                        {cluster.notes.length} {cluster.notes.length === 1 ? 'note' : 'notes'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Notes List */}
                                        <DroppableCluster id={cluster.cluster_title}>
                                            {cluster.notes.length === 0 ? (
                                                <div className="text-center text-gray-400 py-8">
                                                    Drag notes here or add new ones
                                                </div>
                                            ) : (
                                                cluster.notes.map((note, noteIdx) => (
                                                    <SortableNoteItem
                                                        key={`${cluster.cluster_title}::${noteIdx}`}
                                                        note={note}
                                                        index={noteIdx}
                                                        clusterTitle={cluster.cluster_title}
                                                        isEditing={
                                                            editingNote.clusterTitle === cluster.cluster_title &&
                                                            editingNote.noteText === note
                                                        }
                                                        editedText={editedNoteText}
                                                        onTextChange={setEditedNoteText}
                                                        onEdit={() => startEditingNote(cluster.cluster_title, note)}
                                                        onDelete={() => deleteNote(cluster.cluster_title, note)}
                                                        onSave={saveNote}
                                                        onCancel={() => setEditingNote({ clusterTitle: null, noteText: null })}
                                                    />
                                                ))
                                            )}
                                        </DroppableCluster>
                                    </div>
                                </SortableContext>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Drag Overlay: shows what you're dragging */}
            <DragOverlay>
                {activeId ? (
                    <div className="bg-orange-100 p-3 rounded-lg border-2 border-orange-400 shadow-xl opacity-90">
                        Dragging note...
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}