/* The menu normally comes from api/data (current prices from the admin).
 * If that did not work (opened as a local file, first visit offline, server error),
 * load the copy shipped with the site. document.write from a parser-blocking script
 * runs the injected script before js/app.js, so the page always has its data. */
if (!window.AZUMA_DATA) document.write('<script src="js/data.js"><\/script>');
