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
   // The pan animation itself is pure CSS (see .ftsk-hero-slide in
   // _hero.scss) - this just swaps which slide has the "is-active" class.
   $('.ftsk-hero-slideshow').each(function () {
      var $slides = $(this).find('.ftsk-hero-slide');
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

   // Túrabeszámolók (turak) list page - client-side filter toolbar (see
   // layouts/turak/list.html). Everything lives in the DOM already (no
   // pagination), this just toggles ".is-hidden" on cards that don't match.
   var $turakGrid = $('#ftsk-turak-grid');
   if ($turakGrid.length) {
      var $turakCards = $turakGrid.find('.ftsk-turak-card');
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
         var visible = 0;
         var hasActiveFilter = term || decade || activeCategories.length > 0;

         // Any active filter (search, decade or category) replaces the
         // "newest" highlight with the matching results below rather than
         // showing both at once.
         $turakFeatured.toggleClass('d-none', hasActiveFilter);

         $turakCards.each(function () {
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
            var isVisible = matchesSearch && matchesDecade && matchesCategory && !isFeaturedDuplicate;
            $card.toggleClass('is-hidden', !isVisible);
            if (isVisible) visible++;
         });

         $turakCount.text(visible + ' beszámoló található');
         $turakEmpty.toggleClass('d-none', visible !== 0);
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
});
