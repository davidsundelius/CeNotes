<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue';

  const emit = defineEmits(['close']);
  const loading = ref(true);
  const voices = ref<{members: Array<string>, songs: Array<any>}>({members: [], songs: []});
  const selectedMembers = ref<Array<string>>([]);
  const availableSongs = ref<Array<any>>([]);

  watch(selectedMembers, () => calculateAvailableSongs(), {deep: true, immediate: true});

  onMounted(() => {
    loadVoices();
  });

  async function loadVoices() {
    loading.value = true;
    voices.value = await fetch('./voices.json').then((res) => res.json());
    voices.value.songs.forEach((song: any) => {
      song.voices = Object.getOwnPropertyNames(song).filter((key) => key !== 'name');
    });
    calculateAvailableSongs();
    loading.value = false;
  }

  function calculateAvailableSongs() {
    if(voices.value) {
      availableSongs.value = voices.value.songs.filter((song: any) => song.voices.every((voice: string) => song[voice].some((member: string) => selectedMembers.value.includes(member))));
    }
  }
</script>

<template>
  <div>
    <h1>Låtväljaren</h1>
    <div v-if="!loading">
      <div v-for="(voice, index) in voices.members" :key="index">
        <input :id="voice" :value="voice" type="checkbox" v-model="selectedMembers"><label :for="voice">{{ voice }}</label>
      </div>
      <h4>Tillgänga låtar:</h4>
      <div v-for="(song, index) in availableSongs" :key="index">
        <strong>{{ song.name }}</strong>
        <div v-for="(voice, index) in song.voices" :key="index">
          <strong>{{ voice }}: </strong>
          <span v-for="(member, index) in song[voice].filter((m: any) => selectedMembers.includes(m))" :key="index">
            {{ member }}<span v-if="index !== song[voice].filter((m: any) => selectedMembers.includes(m)).length-1">, </span>
          </span>
        </div>
        <br/>
      </div>
    </div>
    <div v-else>
      Laddar...
    </div>
    <button @click="emit('close')">Stäng låtväljaren</button>
  </div>
</template>