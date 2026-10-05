$(document).ready(function () {
   'use strict';

   $(window).on('scroll', function () {
      var windscroll = $(window).scrollTop();
      if (windscroll >= 70) {
         $('#mainnavigationBar').addClass('sticky-nav');
      } else {
         $('#mainnavigationBar').removeClass('sticky-nav');
      }
   });
   $('.navbar-toggler').on('click', function () {
      var navbar = $('#mainnavigationBar');
      navbar.toggleClass('bg-nav');
   });


   // Magnific Popup
   $('.popup-vimeo').magnificPopup({
      disableOn: 700,
      type: 'iframe',
      mainClass: 'mfp-fade',
      removalDelay: 160,
      preloader: false,
      fixedContentPos: false,
   });

   $('.ftsk-gallery-grid').magnificPopup({
      delegate: 'a',
      type: 'image',
      gallery: { enabled: true },
      mainClass: 'mfp-fade',
   });

   // Embedded article photos (see layouts/_default/_markup/render-image.html) -
   // grouped into one lightbox gallery per article.
   $('.ftsk-prose').magnificPopup({
      delegate: '.ftsk-article-figure-link',
      type: 'image',
      gallery: { enabled: true },
      mainClass: 'mfp-fade',
   });

   // Member tile / author badge popup (member-tile.html on the Tagjaink page +
   // participant cards, author-badge.html on the túrabeszámolók list) - both
   // share the ".ftsk-member-trigger" class, so one delegate covers all of them.
   $(document).on('click', '.ftsk-member-trigger', function () {
      var $tile = $(this);
      var name = $tile.data('name');
      var $modal = $('#ftsk-member-modal');

      $modal.find('.ftsk-member-modal-name').text(name);
      var group = $tile.data('group');
      $modal.find('.ftsk-member-modal-group').text(group || '').toggleClass('d-none', !group);

      var role = $tile.data('role');
      $modal.find('.ftsk-member-modal-role').text(role || '').toggleClass('d-none', !role);

      var bio = $tile.data('bio');
      $modal.find('.ftsk-member-modal-bio').text(bio || '').toggleClass('d-none', !bio);

      var $avatar = $modal.find('.ftsk-member-modal-avatar').empty();
      var image = $tile.data('modal-image') || $tile.data('image');
      if (image) {
         $avatar.attr('class', 'ftsk-member-modal-avatar');
         $('<img>').attr({ src: image, alt: name, loading: 'lazy' }).appendTo($avatar);
      } else {
         $avatar.attr(
            'class',
            'ftsk-member-modal-avatar ftsk-member-modal-avatar--initials ftsk-avatar-' + $tile.data('avatar-color')
         );
         $('<span>').addClass('ftsk-member-modal-initials').text($tile.data('initials')).appendTo($avatar);
      }

      $.magnificPopup.open({
         items: { src: '#ftsk-member-modal' },
         type: 'inline',
         mainClass: 'mfp-fade ftsk-member-mfp',
         closeOnBgClick: true,
      });
   });

   // Hero banner slideshow: slow Ken Burns crossfade, looping circularly.
   // Shared POI framing handles motion; CSS handles crossfades while this
   // controller swaps which slide has the "is-active" class.
   $('.ftsk-hero-slideshow').each(function () {
      var $slides = $(this).find('.ftsk-hero-slide');
      if (window.FTSKHeroFraming) window.FTSKHeroFraming.attach(this);
      if ($slides.length < 2) {
         return;
      }

      var current = $slides.filter('.is-active').first().index();
      if (current < 0) {
         current = 0;
      }

      // The initially "is-active" slide is always index 0, but it may be hidden on
      // this viewport (data-hide-below in data/hero_images.yaml) - jump to the first
      // visible slide instead of starting the show on a blank frame.
      if (!$slides.eq(current).is(':visible')) {
         for (var i = 0; i < $slides.length; i++) {
            if ($slides.eq(i).is(':visible')) {
               $slides.eq(current).removeClass('is-active');
               $slides.eq(i).addClass('is-active');
               current = i;
               break;
            }
         }
      }

      var reduceMotion =
         window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      window.addEventListener('resize', function () {
         if ($slides.eq(current).is(':visible')) return;
         var $visible = $slides.filter(':visible').first();
         if ($visible.length) {
            $slides.removeClass('is-active');
            $visible.addClass('is-active');
            current = $slides.index($visible);
         }
      });

      setInterval(
         function () {
            // Skip past any slides hidden on this viewport rather than crossfading
            // to an invisible one, which would look like the show froze.
            var next = current;
            for (var i = 0; i < $slides.length; i++) {
               next = (next + 1) % $slides.length;
               if ($slides.eq(next).is(':visible')) {
                  break;
               }
            }
            if (next === current) {
               return;
            }
            $slides.eq(current).removeClass('is-active');
            $slides.eq(next).addClass('is-active');
            current = next;
         },
         reduceMotion ? 7000 : 6000
      );
   });

   const counterUp = window.counterUp.default

const callback = entries => {
   entries.forEach( entry => {
      const el = entry.target
      if ( entry.isIntersecting && ! el.classList.contains( 'is-visible' ) ) {
         counterUp( el, {
            duration: 1000,
            delay: 16,
         } )
         el.classList.add( 'is-visible' )
      }
   } )
}

const IO = new IntersectionObserver( callback, { threshold: 1 } )

const els = document.querySelectorAll( '.counter' )
els.forEach(el => {
   IO.observe( el )
})



   //Show password
   $('.viewPassword').click(function () {
      $(this).toggleClass('fa-eye fa-eye-slash');
      var input = $($(this).attr('toggle'));
      if (input.attr('type') == 'password') {
         input.attr('type', 'text');
      } else {
         input.attr('type', 'password');
      }
   });
   // Scroll spy style start
   $('.nav-link').click(function () {
      $('.nav-link').removeClass('active');
      $(this).addClass('active');
   });


   $('.nav-item.dropdown > .dropdown-link').on('click', function(e) {
      if($(window).width() < 991.98) {
        e.preventDefault();
        var dropdownOpened = $(this).parent().hasClass('show');
        $('.dropdown').removeClass('show');
        $('.dropdown-menu').removeClass('show');
        
        if (!dropdownOpened) {
          $(this).next('.dropdown-menu').addClass('show');
          $(this).parent('.dropdown').addClass('show');
        }
      }
    });

   // Add active class to the current accordionExample
   var header = document.getElementById('accordionExample');
   var btns = header && header.getElementsByClassName('accordion-item');
   if (btns) {
      for (var i = 0; i < btns.length; i++) {
         btns[i].addEventListener('click', function () {
            var current = document.getElementsByClassName('shows');
            current[0].className = current[0].className.replace(' shows', '');
            this.className += ' shows';
         });
      }
   }

   function createArchivePager($grid, $controls) {
      var $cards = $grid.children();
      var $matches = $cards;
      var currentPage = 1;
      var $size = $controls.find('select');
      var $status = $controls.find('.ftsk-archive-page-status');
      var $previous = $controls.find('[data-page-step="-1"]');
      var $next = $controls.find('[data-page-step="1"]');

      function render() {
         var pageSize = $size.val() === 'all' ? Math.max(1, $matches.length) : Number($size.val());
         var pageCount = Math.max(1, Math.ceil($matches.length / pageSize));
         currentPage = Math.min(currentPage, pageCount);
         var start = (currentPage - 1) * pageSize;
         $cards.addClass('is-hidden');
         $matches.slice(start, start + pageSize).removeClass('is-hidden');
         $status.text($matches.length ? (start + 1) + '–' + Math.min(start + pageSize, $matches.length) + ' / ' + $matches.length + ' · ' + currentPage + ' / ' + pageCount : '0 / 0');
         $previous.prop('disabled', currentPage === 1);
         $next.prop('disabled', currentPage === pageCount);
      }

      $size.on('change', function () {
         currentPage = 1;
         render();
      });
      $controls.find('[data-page-step]').on('click', function () {
         currentPage += Number($(this).attr('data-page-step'));
         render();
         $grid[0].scrollIntoView({ block: 'start' });
      });

      return function ($filtered) {
         $matches = $filtered;
         currentPage = 1;
         render();
      };
   }

   var $turakGrid = $('#ftsk-turak-grid');
   if ($turakGrid.length) {
      var $turakCards = $turakGrid.find('.ftsk-turak-card');
      var paginateTurak = createArchivePager($turakGrid, $('#ftsk-turak-pager'));
      var $turakSearch = $('#ftsk-turak-search');
      var $turakSuggestions = $('#ftsk-turak-suggestions');
      var $turakFeatured = $('#ftsk-turak-featured');
      var $turakDecade = $('#ftsk-turak-decade');
      var $turakPills = $('.ftsk-turak-pill');
      var $turakCount = $('#ftsk-turak-count');
      var $turakEmpty = $('#ftsk-turak-empty');
      var $turakResetButtons = $('#ftsk-turak-reset, #ftsk-turak-empty-reset');
      var activeCategories = [];

      // Autocomplete-like tips: builds suggestions straight from the cards
      // already in the DOM (title/author), no extra request needed.
      function updateTurakSuggestions(term) {
         if (!$turakSuggestions.length) {
            return;
         }
         if (term.length < 2) {
            $turakSuggestions.addClass('d-none').empty();
            return;
         }

         var matches = [];
         $turakCards.each(function () {
            if (matches.length >= 6) {
               return;
            }
            var $card = $(this);
            var title = ($card.data('title') || '').toString();
            var author = ($card.data('author') || '').toString();
            if (title.toLowerCase().indexOf(term) !== -1 || author.toLowerCase().indexOf(term) !== -1) {
               matches.push({ title: title, author: author, href: $card.data('href') });
            }
         });

         $turakSuggestions.empty();
         if (!matches.length) {
            $turakSuggestions.addClass('d-none');
            return;
         }

         matches.forEach(function (match) {
            var $suggestion = $('<a>')
               .addClass('ftsk-turak-suggestion')
               .attr({ href: match.href, role: 'option' })
               .append($('<span>').addClass('ftsk-turak-suggestion-title').text(match.title));
            if (match.author) {
               $suggestion.append($('<span>').addClass('ftsk-turak-suggestion-author').text(match.author));
            }
            $suggestion.appendTo($turakSuggestions);
         });
         $turakSuggestions.removeClass('d-none');
      }

      function applyTurakFilters() {
         var term = $.trim($turakSearch.val()).toLowerCase();
         var decade = $turakDecade.val();
         var hasActiveFilter = term || decade || activeCategories.length > 0;

         // Any active filter (search, decade or category) replaces the
         // "newest" highlight with the matching results below rather than
         // showing both at once.
         $turakFeatured.toggleClass('d-none', hasActiveFilter);

         var $matches = $turakCards.filter(function () {
            var $card = $(this);
            var cardCategories = ($card.data('categories') || '').toString().split(' ');
            var matchesSearch = !term || ($card.data('search') || '').toString().indexOf(term) !== -1;
            var matchesDecade = !decade || $card.data('decade').toString() === decade;
            var matchesCategory =
               activeCategories.length === 0 ||
               cardCategories.some(function (c) {
                  return activeCategories.indexOf(c) !== -1;
               });
            // The 2 "Legújabb" reports stay hidden from the grid below until a
            // filter is active, so they aren't shown twice on the page at once.
            var isFeaturedDuplicate = $card.data('featured') && !hasActiveFilter;
            return matchesSearch && matchesDecade && matchesCategory && !isFeaturedDuplicate;
         });

         paginateTurak($matches);
         $turakCount.text($matches.length + ' beszámoló található');
         $turakEmpty.toggleClass('d-none', $matches.length !== 0);
         $turakResetButtons.filter('#ftsk-turak-reset').toggleClass('d-none', !hasActiveFilter);
      }

      $turakSearch.on('input', function () {
         var term = $.trim($turakSearch.val()).toLowerCase();
         applyTurakFilters();
         updateTurakSuggestions(term);
      });
      $turakSearch.on('focus', function () {
         updateTurakSuggestions($.trim($turakSearch.val()).toLowerCase());
      });
      $turakSearch.on('keydown', function (e) {
         if (e.key === 'Escape') {
            $turakSuggestions.addClass('d-none');
         }
      });
      $(document).on('click', function (e) {
         if (!$(e.target).closest('.ftsk-turak-search').length) {
            $turakSuggestions.addClass('d-none');
         }
      });

      $turakDecade.on('change', applyTurakFilters);

      $turakPills.on('click', function () {
         var $pill = $(this);
         var category = $pill.data('category');

         if (!category) {
            activeCategories = [];
         } else {
            var idx = activeCategories.indexOf(category);
            if (idx === -1) {
               activeCategories.push(category);
            } else {
               activeCategories.splice(idx, 1);
            }
         }

         $turakPills.removeClass('is-active');
         if (activeCategories.length === 0) {
            $turakPills.filter('[data-category=""]').addClass('is-active');
         } else {
            $turakPills.filter(function () {
               return activeCategories.indexOf($(this).data('category')) !== -1;
            }).addClass('is-active');
         }

         applyTurakFilters();
      });

      $turakResetButtons.on('click', function () {
         $turakSearch.val('');
         $turakDecade.val('');
         activeCategories = [];
         $turakPills.removeClass('is-active');
         $turakPills.filter('[data-category=""]').addClass('is-active');
         applyTurakFilters();
         updateTurakSuggestions('');
      });

      applyTurakFilters();
   }

   var $courseGrid = $('#ftsk-course-grid');
   if ($courseGrid.length) {
      var $courseCards = $courseGrid.children();
      var $courseSearch = $('#ftsk-course-search');
      var $courseYear = $('#ftsk-course-year');
      var $courseReset = $('#ftsk-course-reset');
      var paginateCourses = createArchivePager($courseGrid, $('#ftsk-course-pager'));

      function applyCourseFilters() {
         var term = $.trim($courseSearch.val()).toLowerCase();
         var year = $courseYear.val();
         var $matches = $courseCards.filter(function () {
            return (!term || $(this).attr('data-search').indexOf(term) !== -1) &&
               (!year || $(this).attr('data-year') === year);
         });
         paginateCourses($matches);
         $('#ftsk-course-count').text($matches.length + ' tanfolyam található');
         $('#ftsk-course-empty').toggleClass('d-none', $matches.length !== 0);
         $courseReset.toggleClass('d-none', !term && !year);
      }

      $courseSearch.on('input', applyCourseFilters);
      $courseYear.on('change', applyCourseFilters);
      $courseReset.on('click', function () {
         $courseSearch.val('');
         $courseYear.val('');
         applyCourseFilters();
      });
      applyCourseFilters();
   }

   // Sitewide search (navbar search box, see layouts/partials/navbar.html) -
   // fetches /searchindex.json (generated by layouts/index.searchindex.json)
   // once, then filters entirely client-side. Results are real <a href> links
   // (title + section/author meta), so clicking one just navigates normally -
   // no extra JS routing needed.
   var $searchToggle = $('#ftskSearchToggle');
   if ($searchToggle.length) {
      var $searchPanel = $('#ftskSearchPanel');
      var $searchInput = $('#ftskSearchInput');
      var $searchResults = $('#ftskSearchResults');
      var $searchEmpty = $('#ftskSearchEmpty');
      var searchIndex = null;
      var searchIndexPromise = null;

      var SEARCH_SECTION_LABELS = {
         turak: 'Túra',
         tanfolyamok: 'Tanfolyam',
         '': 'Oldal',
      };
      var SEARCH_SECTION_ICONS = {
         turak: 'ph-mountains',
         tanfolyamok: 'ph-graduation-cap',
      };

      function searchSectionLabel(item) {
         var label = SEARCH_SECTION_LABELS[item.section] || (item.section ? item.section : 'Oldal');
         return item.kind === 'section' ? label + ' (rovat)' : label;
      }

      function loadSearchIndex() {
         if (!searchIndexPromise) {
            searchIndexPromise = $.when(window.FTSK404Ready).then(function () {
               return $.getJSON($searchToggle.attr('data-search-index'));
            })
               .done(function (data) {
                  searchIndex = data || [];
               })
               .fail(function () {
                  searchIndex = [];
               });
         }
         return searchIndexPromise;
      }

      function renderSearchResults(term) {
         if (!term) {
            $searchResults.addClass('d-none').empty();
            $searchEmpty.addClass('d-none');
            return;
         }

         var matches = $.grep(searchIndex || [], function (item) {
            return (
               item.title.toLowerCase().indexOf(term) !== -1 ||
               (item.summary && item.summary.toLowerCase().indexOf(term) !== -1) ||
               (item.author && item.author.toLowerCase().indexOf(term) !== -1)
            );
         }).slice(0, 12);

         $searchResults.empty();
         if (!matches.length) {
            $searchResults.addClass('d-none');
            $searchEmpty.removeClass('d-none');
            return;
         }
         $searchEmpty.addClass('d-none');

         matches.forEach(function (item) {
            var icon = SEARCH_SECTION_ICONS[item.section] || 'ph-file-text';
            var $result = $('<a>')
               .addClass('ftsk-nav-search-result')
               .attr('href', item.url)
               .append($('<i>').addClass('ph ' + icon).attr('aria-hidden', 'true'));
            var $body = $('<span>').addClass('ftsk-nav-search-result-body');
            $body.append($('<span>').addClass('ftsk-nav-search-result-title').text(item.title));
            var meta = searchSectionLabel(item);
            if (item.author) {
               meta += ' · ' + item.author;
            }
            $body.append($('<span>').addClass('ftsk-nav-search-result-meta').text(meta));
            $result.append($body);
            $result.appendTo($searchResults);
         });
         $searchResults.removeClass('d-none');
      }

      function openSearchPanel() {
         $searchPanel.removeClass('d-none');
         $searchToggle.addClass('is-active').attr('aria-expanded', 'true');
         loadSearchIndex().always(function () {
            renderSearchResults($.trim($searchInput.val()).toLowerCase());
         });
         $searchInput.trigger('focus');
      }

      function closeSearchPanel() {
         $searchPanel.addClass('d-none');
         $searchToggle.removeClass('is-active').attr('aria-expanded', 'false');
      }

      $searchToggle.on('click', function () {
         if ($searchPanel.hasClass('d-none')) {
            openSearchPanel();
         } else {
            closeSearchPanel();
         }
      });

      $searchInput.on('input', function () {
         renderSearchResults($.trim($searchInput.val()).toLowerCase());
      });

      $searchInput.on('keydown', function (e) {
         if (e.key === 'Escape') {
            closeSearchPanel();
         }
      });

      $(document).on('click', function (e) {
         if (!$(e.target).closest('#ftskSearchToggle, #ftskSearchPanel').length) {
            closeSearchPanel();
         }
      });
   }
});
