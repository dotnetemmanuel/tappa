<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Täppa</title>
	<meta name="description" content="Rita din tomt i skala, plantera och se skuggorna falla." />
	<meta name="theme-color" content="#14211c" />
</svelte:head>

{@render children()}
