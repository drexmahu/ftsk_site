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

   // Member tile popup
   $('.ftsk-members-grid').on('click', '.ftsk-members-tile', function () {
      var $tile = $(this);
      var name = $tile.data('name');
      var $modal = $('#ftsk-member-modal');

      $modal.find('.ftsk-member-modal-name').text(name);
      $modal.find('.ftsk-member-modal-group').text($tile.data('group'));

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

      var reduceMotion =
         window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      setInterval(
         function () {
            var next = (current + 1) % $slides.length;
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
});
