import { useEffect, useRef, useState } from 'react'
import {
  Alert, Dimensions, FlatList, Image, Modal,
  Pressable, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import * as SQLite from 'expo-sqlite'
import { useShareIntent } from 'expo-share-intent'

// ─── DB ───────────────────────────────────────────────────────────────────────

const db = SQLite.openDatabaseSync('inspo.db')

function setupDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      uri TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS item_projects (
      itemId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      PRIMARY KEY (itemId, projectId)
    );
  `)
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const COLORS = ['#C8FF00','#FF6B35','#A78BFA','#38BDF8','#F472B6','#34D399']

// ─── Types ────────────────────────────────────────────────────────────────────

type Project = { id: string; name: string; color: string; createdAt: number }
type Item    = { id: string; uri: string; createdAt: number; projects: string[] }

// ─── Project Picker Modal ─────────────────────────────────────────────────────

function ProjectModal({
  visible, projects, onSave, onClose,
}: {
  visible: boolean
  projects: Project[]
  onSave: (selected: string[], newName?: string) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [newName, setNewName] = useState('')

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const handleSave = () => {
    onSave(selected, newName.trim() || undefined)
    setSelected([])
    setNewName('')
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={s.modalWrap}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Add to project</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.modalClose}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.chipWrap}>
          {projects.map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => toggle(p.id)}
              style={[
                s.chip,
                selected.includes(p.id) && { backgroundColor: p.color + '33', borderColor: p.color },
              ]}
            >
              <Text style={[s.chipText, selected.includes(p.id) && { color: p.color }]}>
                {selected.includes(p.id) ? '✓ ' : ''}{p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.newRow}>
          <TextInput
            style={s.newInput}
            placeholder="New project..."
            placeholderTextColor="#666"
            value={newName}
            onChangeText={setNewName}
          />
        </View>

        <TouchableOpacity
          style={[s.saveBtn, (selected.length > 0 || newName.trim()) && s.saveBtnActive]}
          onPress={handleSave}
        >
          <Text style={[s.saveBtnText, (selected.length > 0 || newName.trim()) && s.saveBtnTextActive]}>
            Save
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const W = Dimensions.get('window').width
const COLS = 3
const CELL = (W - 2) / COLS

export default function App() {
  const [projects, setProjects]   = useState<Project[]>([])
  const [items, setItems]         = useState<Item[]>([])
  const [filter, setFilter]       = useState<string | null>(null)
  const [modalVisible, setModal]  = useState(false)
  const [pendingUri, setPending]  = useState<string | null>(null)

  const { shareIntent, resetShareIntent } = useShareIntent()

  // ─── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setupDb()
    loadAll()
  }, [])

  // ─── Handle share intent ───────────────────────────────────────────────────

  useEffect(() => {
    if (!shareIntent?.files?.length) return
    const file = shareIntent.files[0]
    setPending(file.path)
    setModal(true)
    resetShareIntent()
  }, [shareIntent])

  // ─── Data ──────────────────────────────────────────────────────────────────

  function loadAll() {
    const ps = db.getAllSync<Project>('SELECT * FROM projects ORDER BY createdAt ASC')
    setProjects(ps)

    const rows = db.getAllSync<Omit<Item, 'projects'>>('SELECT * FROM items ORDER BY createdAt DESC')
    const withProjects = rows.map(row => {
      const pRows = db.getAllSync<{ projectId: string }>(
        'SELECT projectId FROM item_projects WHERE itemId = ?', [row.id]
      )
      return { ...row, projects: pRows.map(r => r.projectId) }
    })
    setItems(withProjects)
  }

  // ─── Add image ─────────────────────────────────────────────────────────────

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] })
    if (res.canceled) return
    setPending(res.assets[0].uri)
    setModal(true)
  }

  async function saveItem(selected: string[], newProjectName?: string) {
    if (!pendingUri) return

    // Copy image to app docs dir
    const ext = pendingUri.split('.').pop() ?? 'jpg'
    const filename = `${uid()}.${ext}`
    const dest = FileSystem.documentDirectory + filename
    await FileSystem.copyAsync({ from: pendingUri, to: dest })

    const id = uid()
    const now = Date.now()

    db.runSync(
      'INSERT INTO items (id, uri, createdAt) VALUES (?, ?, ?)',
      [id, dest, now]
    )

    let projectIds = [...selected]

    if (newProjectName) {
      const pid = uid()
      const color = COLORS[projects.length % COLORS.length]
      db.runSync(
        'INSERT INTO projects (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
        [pid, newProjectName, color, now]
      )
      projectIds.push(pid)
    }

    for (const pid of projectIds) {
      db.runSync(
        'INSERT OR IGNORE INTO item_projects (itemId, projectId) VALUES (?, ?)',
        [id, pid]
      )
    }

    setPending(null)
    setModal(false)
    loadAll()
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const filtered = filter
    ? items.filter(i => i.projects.includes(filter))
    : items

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>inspo</Text>
        <TouchableOpacity style={s.addBtn} onPress={pickImage}>
          <Text style={s.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Project filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}
      >
        <TouchableOpacity
          style={[s.pill, !filter && s.pillActive]}
          onPress={() => setFilter(null)}
        >
          <Text style={[s.pillText, !filter && s.pillTextActive]}>All</Text>
        </TouchableOpacity>
        {projects.map(p => (
          <TouchableOpacity
            key={p.id}
            style={[s.pill, filter === p.id && { backgroundColor: p.color + '22', borderColor: p.color }]}
            onPress={() => setFilter(filter === p.id ? null : p.id)}
          >
            <Text style={[s.pillText, filter === p.id && { color: p.color }]}>{p.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Grid */}
      <FlatList
        data={filtered}
        numColumns={COLS}
        keyExtractor={i => i.id}
        contentContainerStyle={s.grid}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.uri }}
            style={{ width: CELL, height: CELL, margin: 0.5 }}
            resizeMode="cover"
          />
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>Tap + to add your first image</Text>
          </View>
        }
      />

      {/* Modal */}
      <ProjectModal
        visible={modalVisible}
        projects={projects}
        onSave={saveItem}
        onClose={() => { setModal(false); setPending(null) }}
      />
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#fff' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  logo:          { fontSize: 20, fontWeight: '600', letterSpacing: -0.5, color: '#0a0a0a' },
  addBtn:        { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  addBtnText:    { color: '#fff', fontSize: 20, lineHeight: 22 },
  filters:       { paddingHorizontal: 12, paddingBottom: 10, gap: 6, flexDirection: 'row' },
  pill:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: '#e5e5e5' },
  pillActive:    { backgroundColor: '#0a0a0a', borderColor: '#0a0a0a' },
  pillText:      { fontSize: 12, color: '#888', fontWeight: '500' },
  pillTextActive:{ color: '#fff' },
  grid:          { gap: 0 },
  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120 },
  emptyText:     { color: '#aaa', fontSize: 14 },
  modalWrap:     { flex: 1, backgroundColor: '#fff', padding: 20 },
  modalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle:    { fontSize: 17, fontWeight: '600', color: '#0a0a0a' },
  modalClose:    { fontSize: 16, color: '#007AFF' },
  chipWrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 20 },
  chip:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: '#e5e5e5' },
  chipText:      { fontSize: 13, color: '#888', fontWeight: '500' },
  newRow:        { marginBottom: 16 },
  newInput:      { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 12, padding: 14, fontSize: 15, color: '#0a0a0a' },
  saveBtn:       { backgroundColor: '#f0f0f0', borderRadius: 14, padding: 16, alignItems: 'center' },
  saveBtnActive: { backgroundColor: '#0a0a0a' },
  saveBtnText:   { fontSize: 15, fontWeight: '600', color: '#aaa' },
  saveBtnTextActive: { color: '#fff' },
})
