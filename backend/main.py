from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from transformers import pipeline
from typing import List, Optional
import json
import os
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# Initialize FastAPI app
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "null"], # "null" allows local file
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Configuration & Constants =====
CLUSTER_FILE = "clusters.json"
SIMILARITY_THRESHOLD = 0.35

# After loading the model
try:
    embedder = SentenceTransformer('paraphrase-MiniLM-L6-v2')
        
except Exception as e:
    print(f"Error with SentenceTransformer: {e}")
    raise


try:
    title_generator = pipeline("text2text-generation", model="google/flan-t5-small")
except Exception as e:
    print(f"Error loading Title Generator: {e}. Using dummy title generator.")
    def title_generator(prompt, **kwargs): return [{'generated_text': 'General'}]

# ===== Utility functions =====

def load_clusters() -> List[dict]:
    """Loads clusters from the JSON file, ensuring user_edited flag exists."""
    if os.path.exists(CLUSTER_FILE):
        try:
            with open(CLUSTER_FILE, "r", encoding="utf-8") as f:
                clusters = json.load(f)
                for cluster in clusters:
                    if 'user_edited' not in cluster:
                        cluster['user_edited'] = False
                return clusters
        except json.JSONDecodeError:
            print(f"Warning: {CLUSTER_FILE} is corrupted. Starting with an empty list.")
            return []
    return []

def save_clusters(clusters: List[dict]):
    """Saves clusters to the JSON file."""
    with open(CLUSTER_FILE, "w", encoding="utf-8") as f:
        json.dump(clusters, f, indent=4, ensure_ascii=False)

def generate_title(notes: List[str]) -> str:
    """Generates a category title using the T5 model."""
    if not notes:
        return "Untitled"
    text = " ".join(notes[-5:])
    prompt = (
        "From the following notes, infer a broad general category "
        "(like Travel, Food, Health, Games, Work, Education, etc.) "
        "that best represents their theme. Respond with only one or two words.\n"
        f"Notes: {text}\nCategory:"
    )
    title = title_generator(
        prompt,
        max_new_tokens=4,
        num_return_sequences=1,
        do_sample=False
    )[0]['generated_text'].strip()
    return title.split()[0].capitalize()

def get_cluster_embedding(cluster: dict) -> np.ndarray:
    """Calculates the mean embedding for a cluster's notes."""
    if not cluster.get("notes"):
        return np.array([], dtype=np.float32)
    embeddings = embedder.encode(cluster["notes"], convert_to_numpy=True)
    return np.mean(embeddings, axis=0)

def find_best_cluster(note: str, clusters: List[dict]) -> Optional[int]:
    if not clusters:
        return None

    note_embedding = embedder.encode([note], convert_to_numpy=True)[0].reshape(1, -1)
    
    best_title_idx = None
    best_title_score = 0.0
    best_note_idx = None
    best_note_score = 0.0
    
    print(f"\n Finding cluster for: '{note}'")
    print(f"Title threshold: {SIMILARITY_THRESHOLD}")
    print(f"Note threshold: {SIMILARITY_THRESHOLD}")
    
    for i, cluster in enumerate(clusters):
        cluster_title = cluster['cluster_title']
        cluster_notes = cluster.get("notes", [])
        
        print(f"\n  Cluster '{cluster_title}':")
        
        # Check 1: Compare with cluster title
        title_embedding = embedder.encode([cluster_title], convert_to_numpy=True)
        title_similarity = cosine_similarity(note_embedding, title_embedding)[0][0]
        print(f"Title match: {title_similarity:.3f}", end="")
        
        if title_similarity > SIMILARITY_THRESHOLD:
            print(f" PASSES")
            if title_similarity > best_title_score:
                best_title_score = title_similarity
                best_title_idx = i
        else:
            print(f" X")
            # Only check notes if title didn't pass
            if cluster_notes:
                cluster_note_embeddings = embedder.encode(cluster_notes, convert_to_numpy=True)
                similarities = cosine_similarity(note_embedding, cluster_note_embeddings)[0]
                max_note_similarity = np.max(similarities)
                
                print(f"Best note match: {max_note_similarity:.3f}", end="")
                
                if max_note_similarity > SIMILARITY_THRESHOLD:
                    print(f" PASSES")
                    if max_note_similarity > best_note_score:
                        best_note_score = max_note_similarity
                        best_note_idx = i
                else:
                    print(f" X")
    
    # Title matches always win over note matches
    if best_title_idx is not None:
        print(f"\nMatch found: '{clusters[best_title_idx]['cluster_title']}'")
        print(f"  Reason: title similarity ({best_title_score:.3f})")
        return best_title_idx
    elif best_note_idx is not None:
        print(f"\nMatch found: '{clusters[best_note_idx]['cluster_title']}'")
        print(f"  Reason: note similarity ({best_note_score:.3f})")
        return best_note_idx
    else:
        print(f"\nNo match found (nothing above {SIMILARITY_THRESHOLD})")
        return None



# ===== Pydantic Models =====
class AddNoteInput(BaseModel):
    note_text: str

class EditClusterInput(BaseModel):
    cluster_title: str
    new_title: Optional[str] = None
    notes_to_delete: Optional[List[str]] = None
    updated_notes: Optional[List[str]] = None
    note_to_edit: Optional[str] = None
    new_note_text: Optional[str] = None

class DeleteClusterInput(BaseModel):
    """Schema for deleting a cluster."""
    cluster_title: str

class CreateClusterInput(BaseModel):
    new_title: str

class MoveNoteInput(BaseModel):
    source_cluster_title: str
    note_to_move: str
    dest_cluster_title: str

# ----------------------------------------------------------------------
#                         API Endpoints
# ----------------------------------------------------------------------

@app.post("/add_note")
async def add_note(data: AddNoteInput):
    """
    Adds a new note, clustering it with an existing group if a match is found,
    or creating a new cluster otherwise.
    """
    new_note = data.note_text.strip()
    if not new_note:
        raise HTTPException(status_code=400, detail="Note text cannot be empty.")
    
    clusters = load_clusters()
    best_cluster_index = find_best_cluster(new_note, clusters)
    
    if best_cluster_index is not None:
        # Add to existing cluster (semantic match found)
        cluster = clusters[best_cluster_index]
        if new_note not in cluster["notes"]:
            cluster["notes"].append(new_note)
        save_clusters(clusters)
        return {"message": "Note added to existing cluster", "cluster": cluster}
    else:
        # Create new cluster
        new_cluster_notes = [new_note]
        new_title = generate_title(new_cluster_notes)

        print(f"DEBUG: Note '{new_note}' generated title: '{new_title}'")
        
        # Check if a cluster with this title already exists
        existing_title_cluster = None
        for c in clusters:
            if c["cluster_title"] == new_title:
                existing_title_cluster = c
                break
        
        if existing_title_cluster:
            # Title already exists:  add to that cluster
            if new_note not in existing_title_cluster["notes"]:
                existing_title_cluster["notes"].append(new_note)
            save_clusters(clusters)
            return {"message": "Note added to existing cluster by title", "cluster": existing_title_cluster}
        else:
            # Create brand new cluster
            new_cluster = {
                "cluster_title": new_title,
                "notes": new_cluster_notes,
                "user_edited": False 
            }
            clusters.append(new_cluster)
            save_clusters(clusters)
            return {"message": "New cluster created for note", "cluster": new_cluster}


# ----------------------------------------------------------------------

@app.post("/edit_cluster")
async def edit_cluster(data: EditClusterInput):
    """
    Allows user to edit a note, delete notes, or change a cluster title.
    Clusters are NOT automatically deleted when empty.
    """
    clusters = load_clusters()
    found_index = -1

    for i, c in enumerate(clusters):
        if c["cluster_title"] == data.cluster_title:
            found_index = i
            break

    if found_index == -1:
        raise HTTPException(status_code=404, detail="Cluster not found")

    c = clusters[found_index]
    
    # --- 1. Edit a specific note ---
    if data.note_to_edit and data.new_note_text:
        try:
            note_index = c["notes"].index(data.note_to_edit)
            c["notes"][note_index] = data.new_note_text
        except ValueError:
            raise HTTPException(status_code=404, detail=f"Note '{data.note_to_edit}' not found in cluster '{data.cluster_title}'")

    # --- 2. Delete notes if provided ---
    if data.notes_to_delete:
        c["notes"] = [note for note in c["notes"] if note not in data.notes_to_delete]

    # --- 3. Replace all notes if updated_notes provided ---
    if data.updated_notes is not None:
        c["notes"] = data.updated_notes

    # --- 4. Handle Title Update ---
    if data.new_title:
        # Check if new title already exists in another cluster
        for other_cluster in clusters:
            if other_cluster["cluster_title"] == data.new_title and other_cluster != c:
                raise HTTPException(status_code=400, detail="A cluster with this title already exists")
        
        # User manually sets a new title, lock the title
        c["cluster_title"] = data.new_title
        c["user_edited"] = True

    
    save_clusters(clusters)
    return {"message": "Cluster updated", "cluster": c}



@app.post("/delete_cluster")
async def delete_cluster(data: DeleteClusterInput):
    """
    Deletes an entire cluster and all its notes.
    """
    clusters = load_clusters()
    found_index = -1

    for i, c in enumerate(clusters):
        if c["cluster_title"] == data.cluster_title:
            found_index = i
            break

    if found_index == -1:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # Remove the cluster
    deleted_cluster = clusters.pop(found_index)
    save_clusters(clusters)
    
    return {
        "message": f"Cluster '{deleted_cluster['cluster_title']}' deleted", 
        "deleted_notes_count": len(deleted_cluster['notes']),
        "clusters": clusters
    }


@app.get("/clusters")
async def get_clusters():
    """Retrieves all current clusters."""
    return load_clusters()


@app.post("/create_cluster")
async def create_cluster(data: CreateClusterInput):
    """
    Manually creates a new, empty cluster with a locked title.
    """
    clusters = load_clusters()
    new_title = data.new_title.strip()
    
    if not new_title:
        raise HTTPException(status_code=400, detail="Cluster title cannot be empty.")

    # Check for duplicates
    for c in clusters:
        if c["cluster_title"] == new_title:
            raise HTTPException(status_code=400, detail="A cluster with this title already exists.")

    new_cluster = {
        "cluster_title": new_title,
        "notes": [],
        "user_edited": True  # Manually created, so we lock the title
    }
    clusters.append(new_cluster)
    save_clusters(clusters)
    return {"message": "Cluster created", "cluster": new_cluster}



@app.post("/move_note")
async def move_note(data: MoveNoteInput):
    """
    Manually moves a note from one cluster to another.
    Empty clusters are NOT automatically deleted.
    """
    clusters = load_clusters()
    source_cluster = None
    dest_cluster = None

    for c in clusters:
        if c["cluster_title"] == data.source_cluster_title:
            source_cluster = c
        if c["cluster_title"] == data.dest_cluster_title:
            dest_cluster = c
    
    if not source_cluster:
        raise HTTPException(status_code=404, detail="Source cluster not found.")
    if not dest_cluster:
        raise HTTPException(status_code=404, detail="Destination cluster not found.")

    # Find and remove note from source
    if data.note_to_move not in source_cluster["notes"]:
        raise HTTPException(status_code=404, detail="Note not found in source cluster.")
        
    source_cluster["notes"].remove(data.note_to_move)

    # Add note to destination
    if data.note_to_move not in dest_cluster["notes"]:
        dest_cluster["notes"].append(data.note_to_move)


    save_clusters(clusters)
    return {"message": "Note moved", "clusters": clusters}

